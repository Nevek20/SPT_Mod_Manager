/**
 * Fila de downloads (0.7.0): um de cada vez (ou N), instalação sempre sozinha,
 * pausar, continuar, cancelar e reordenar. E a continuação do download de
 * verdade, com servidor que aceita "Range" e com servidor que ignora.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { DownloadQueue, QueueError, type QueueResult, type QueueTask, type QueueJobSnapshot } from "../electron/downloadQueue";
import { criarTarefaDeDownload, configureDownloadCache, limparDownloadsInterrompidos } from "../electron/modManager";

let ok = 0;
let fail = 0;
const check = (l: string, g: unknown, w: unknown) => {
  if (JSON.stringify(g) === JSON.stringify(w)) {
    ok++;
    console.log("  ok   " + l);
  } else {
    fail++;
    console.log(`  FAIL ${l}\n    esperado ${JSON.stringify(w)}\n    obtido   ${JSON.stringify(g)}`);
  }
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await tick();
};

function adiado<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** Tarefa de mentira: o teste decide quando o download e a instalação terminam. */
class Falsa implements QueueTask {
  downloads = 0;
  installs = 0;
  descartada = 0;
  dl = adiado<void>();
  ins = adiado<QueueResult>();
  progresso?: (r: number, t: number) => void;
  constructor(readonly nome: string, private log: string[]) {}
  download(signal: AbortSignal, onProgress: (r: number, t: number) => void) {
    this.downloads++;
    this.progresso = onProgress;
    this.log.push(`dl:${this.nome}`);
    this.dl = adiado<void>();
    signal.addEventListener("abort", () => this.dl.reject(new Error("aborted")));
    return this.dl.promise;
  }
  install() {
    this.installs++;
    this.log.push(`ins:${this.nome}`);
    return this.ins.promise;
  }
  discard() {
    this.descartada++;
  }
}

const estados = (s: QueueJobSnapshot[]) => s.map((j) => `${j.name}:${j.state}`);

(async () => {
  console.log("Um de cada vez");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s));
    const [a, b, c] = ["A", "B", "C"].map((n) => new Falsa(n, log));
    const ra = q.enqueue("a", "A", a);
    const rb = q.enqueue("b", "B", b);
    q.enqueue("c", "C", c);
    await ticks();
    check("só o primeiro baixa", estados(snap), ["A:downloading", "B:queued", "C:queued"]);
    a.dl.resolve();
    await ticks();
    check("A instala e B já começa a baixar", estados(snap), ["A:installing", "B:downloading", "C:queued"]);
    b.dl.resolve();
    await ticks();
    check("B baixou mas espera A instalar", [estados(snap), b.installs], [["A:installing", "B:waiting", "C:downloading"], 0]);
    a.ins.resolve({ success: true, message: "ok A" });
    check("quem chamou recebe o resultado", await ra, { success: true, message: "ok A" });
    await ticks();
    check("aí B instala", estados(snap), ["B:installing", "C:downloading"]);
    b.ins.resolve({ success: false, message: "falhou B" });
    check("falha chega igual", (await rb).message, "falhou B");
    check("falha descarta o que foi baixado", b.descartada, 1);
    check("sucesso não descarta", a.descartada, 0);
  }

  console.log("Vários downloads, instalação sozinha");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(2, (s) => (snap = s));
    const [a, b, c] = ["A", "B", "C"].map((n) => new Falsa(n, log));
    q.enqueue("a", "A", a);
    q.enqueue("b", "B", b);
    q.enqueue("c", "C", c);
    await ticks();
    check("dois baixando ao mesmo tempo", estados(snap), ["A:downloading", "B:downloading", "C:queued"]);
    b.dl.resolve();
    a.dl.resolve();
    await ticks();
    check("só uma instalação por vez", [a.installs + b.installs, snap.filter((j) => j.state === "installing").length], [1, 1]);
    q.setMaxDownloads(3);
    await ticks();
    check("subir o limite libera a vaga", snap.find((j) => j.name === "C")?.state, "downloading");
    const externo = q.exclusive(async () => log.push("externo"));
    a.ins.resolve({ success: true, message: "" });
    await ticks();
    b.ins.resolve({ success: true, message: "" });
    await externo;
    check(
      "instala na ordem em que terminou de baixar, e o arquivo local espera a vez",
      log.filter((x) => x.startsWith("ins") || x === "externo"),
      ["ins:B", "ins:A", "externo"]
    );
  }

  console.log("Pausar e continuar");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s));
    const [a, b] = ["A", "B"].map((n) => new Falsa(n, log));
    q.enqueue("a", "A", a);
    q.enqueue("b", "B", b);
    await ticks();
    check("pausar quem está na fila não vale", q.pause("b"), false);
    check("pausar quem baixa", q.pause("a"), true);
    await ticks();
    check("pausado libera a vaga", estados(snap), ["A:paused", "B:downloading"]);
    check("continuar", q.resume("a"), true);
    await ticks();
    check("volta pra fila sem interromper o atual", estados(snap), ["A:queued", "B:downloading"]);
    b.dl.resolve();
    await ticks();
    check("e retoma quando a vaga abre", [estados(snap), a.downloads], [["A:downloading", "B:installing"], 2]);
    check("continuar quem não está pausado não vale", q.resume("a"), false);
  }

  console.log("Cancelar");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s));
    const [a, b, c, d] = ["A", "B", "C", "D"].map((n) => new Falsa(n, log));
    const ra = q.enqueue("a", "A", a);
    const rb = q.enqueue("b", "B", b);
    q.enqueue("c", "C", c);
    q.enqueue("d", "D", d);
    await ticks();
    check("cancelar quem espera", q.cancel("b"), true);
    const resB = await rb;
    check("sai com cancelled e nunca baixou", [resB.cancelled, b.downloads, b.descartada], [true, 0, 1]);
    check("cancelar quem baixa", q.cancel("a"), true);
    const resA = await ra;
    check("para o download e descarta", [resA.cancelled, a.descartada], [true, 1]);
    await ticks();
    check("o próximo começa", estados(snap), ["C:downloading", "D:queued"]);
    c.dl.resolve();
    await ticks();
    check("durante a instalação não cancela", q.cancel("c"), false);
    d.dl.resolve();
    await ticks();
    check("D baixou e espera a vez", snap.find((j) => j.name === "D")?.state, "waiting");
    check("cancelar quem espera pra instalar", q.cancel("d"), true);
    c.ins.resolve({ success: true, message: "" });
    await ticks();
    check("D nunca instala", [d.installs, d.descartada], [0, 1]);
    check("id desconhecido", q.cancel("zzz"), false);
  }

  console.log("Cancelar fila");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s));
    const fs4 = ["A", "B", "C", "D"].map((n) => new Falsa(n, log));
    fs4.forEach((f, i) => q.enqueue(String(i), f.nome, f));
    await ticks();
    q.pause("0");
    await ticks();
    check("antes", estados(snap), ["A:paused", "B:downloading", "C:queued", "D:queued"]);
    check("cancela pausados e na fila", q.cancelWaiting(), 3);
    await ticks();
    check("o que está baixando continua", estados(snap), ["B:downloading"]);
  }

  console.log("Reordenar");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s));
    const [a, b, c, d] = ["A", "B", "C", "D"].map((n) => new Falsa(n, log));
    q.enqueue("a", "A", a);
    q.enqueue("b", "B", b);
    q.enqueue("c", "C", c);
    q.enqueue("d", "D", d);
    await ticks();
    check("subir", q.move("d", -1), true);
    check("ordem", estados(snap).map((s) => s[0]).join(""), "ABDC");
    check("não passa na frente de quem está baixando", q.move("b", -1), false);
    check("quem baixa não se move", q.move("a", 1), false);
    q.move("c", -1);
    q.move("c", -1);
    check("C sobe duas vezes", estados(snap).map((s) => s[0]).join(""), "ACBD");
    a.dl.resolve();
    await ticks();
    check("e é o próximo a baixar", snap.find((j) => j.name === "C")?.state, "downloading");
    check("descer no fim não vale", q.move("d", 1), false);
  }

  console.log("Instalar depois de outro (dependências)");
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(2, (s) => (snap = s));
    const dep = new Falsa("Dep", log);
    const mod = new Falsa("Mod", log);
    const rDep = q.enqueue("dep", "Dep", dep);
    const rMod = q.enqueue("mod", "Mod", mod, ["dep"]);
    await ticks();
    check("os dois baixam juntos", estados(snap), ["Dep:downloading", "Mod:downloading"]);
    mod.dl.resolve();
    await ticks();
    check("o principal baixou primeiro mas espera a dependência", [estados(snap), mod.installs], [["Dep:downloading", "Mod:waiting"], 0]);
    dep.dl.resolve();
    await ticks();
    check("a dependência instala primeiro", log.filter((x) => x.startsWith("ins")), ["ins:Dep"]);
    dep.ins.resolve({ success: true, message: "" });
    await rDep;
    await ticks();
    check("e só então o principal", log.filter((x) => x.startsWith("ins")), ["ins:Dep", "ins:Mod"]);
    mod.ins.resolve({ success: true, message: "" });
    await rMod;
  }
  {
    const log: string[] = [];
    const q = new DownloadQueue(1);
    const dep = new Falsa("Dep", log);
    const mod = new Falsa("Mod", log);
    q.enqueue("dep", "Dep", dep);
    const rMod = q.enqueue("mod", "Mod", mod, ["dep"]);
    await ticks();
    q.cancel("dep");
    await ticks();
    mod.dl.resolve();
    await ticks();
    check("dependência cancelada: o principal segue (a pessoa escolheu)", mod.installs, 1);
    mod.ins.resolve({ success: true, message: "" });
    check("e instala", (await rMod).success, true);
  }
  {
    const log: string[] = [];
    const q = new DownloadQueue(1);
    const mod = new Falsa("Mod", log);
    const r = q.enqueue("mod", "Mod", mod, ["ja-terminou"]);
    await ticks();
    mod.dl.resolve();
    await ticks();
    mod.ins.resolve({ success: true, message: "" });
    check("depender de quem já terminou não trava", (await r).success, true);
  }
  {
    const log: string[] = [];
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(2, (s) => (snap = s));
    const dep = new Falsa("Dep", log);
    const mod = new Falsa("Mod", log);
    q.enqueue("dep", "Dep", dep);
    const rMod = q.enqueue("mod", "Mod", mod, ["dep"]);
    await ticks();
    mod.dl.resolve();
    await ticks();
    check("cancelar quem espera a dependência", q.cancel("mod"), true);
    check("sai cancelado sem instalar", [(await rMod).cancelled, mod.installs], [true, 0]);
    check("a dependência continua", estados(snap), ["Dep:downloading"]);
  }

  console.log("Fechar o app");
  {
    const log: string[] = [];
    const q = new DownloadQueue(1);
    const [a, b, c] = ["A", "B", "C"].map((n) => new Falsa(n, log));
    q.enqueue("a", "A", a);
    q.enqueue("b", "B", b);
    q.enqueue("c", "C", c);
    await ticks();
    q.pause("a");
    await ticks();
    q.shutdown();
    check("tudo que não está instalando é descartado na hora", [a.descartada, b.descartada, c.descartada], [1, 1, 1]);
  }

  console.log("Erros");
  {
    const log: string[] = [];
    const q = new DownloadQueue(1);
    const a = new Falsa("A", log);
    const b = new Falsa("B", log);
    const ra = q.enqueue("a", "A", a);
    const rb = q.enqueue("b", "B", b);
    await ticks();
    a.dl.reject(new Error("ECONNRESET"));
    check("erro de rede ganha o prefixo de sempre", (await ra).message, "Failed to download/install from Forge: ECONNRESET");
    check("e descarta", a.descartada, 1);
    await ticks();
    b.dl.reject(new QueueError("Couldn't download the mod from Forge (HTTP 404)."));
    check("mensagem final passa sem prefixo", (await rb).message, "Couldn't download the mod from Forge (HTTP 404).");
    const c = new Falsa("C", log);
    const rc = q.enqueue("c", "C", c);
    await ticks();
    c.dl.resolve();
    await ticks();
    c.ins.reject(new Error("EBUSY"));
    check("instalação que explode vira falha", (await rc).success, false);
  }

  console.log("Id repetido");
  {
    const q = new DownloadQueue(1);
    const log: string[] = [];
    q.enqueue("x", "X", new Falsa("X", log));
    const dup = await q.enqueue("x", "X", new Falsa("X2", log));
    check("segundo com o mesmo id falha na hora", dup.success, false);
  }

  console.log("Velocidade");
  {
    let agora = 0;
    let snap: QueueJobSnapshot[] = [];
    const q = new DownloadQueue(1, (s) => (snap = s), () => agora);
    const a = new Falsa("A", []);
    q.enqueue("a", "A", a);
    await ticks();
    a.progresso!(0, 10_000);
    agora = 1000;
    a.progresso!(1000, 10_000);
    check("bytes por segundo da janela recente", Math.round(q.snapshot()[0].speed), 1000);
    agora = 2000;
    a.progresso!(5000, 10_000);
    check("média móvel reage sem pular", Math.round(q.snapshot()[0].speed), 2200);
    q.pause("a");
    await ticks();
    check("pausado mostra 0", snap[0].speed, 0);
  }

  console.log("Continuar download de verdade (Range)");
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "spt-fila-"));
  // Aleatório: bytes repetidos comprimiriam pra quase nada e não haveria "meio" pra pausar.
  const dll = crypto.randomBytes(200_000);
  const zip = (() => {
    const z = new AdmZip();
    z.addFile("Pesado.dll", dll);
    z.addFile("readme.txt", Buffer.from("leia"));
    return z.toBuffer();
  })();
  const pedidos: (string | null)[] = [];
  let aceitaRange = true;
  (globalThis as { fetch: unknown }).fetch = async (_url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    const range = init?.headers?.Range ?? null;
    pedidos.push(range);
    const inicio = range && aceitaRange ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
    const corpo = zip.subarray(inicio);
    // Manda em pedaços de 16 KB, pra dar tempo de pausar no meio.
    const stream = new ReadableStream<Uint8Array>({
      async pull(ctl) {
        const pos = (this as unknown as { pos?: number }).pos ?? 0;
        if (init?.signal?.aborted) return ctl.error(new Error("aborted"));
        if (pos >= corpo.length) return ctl.close();
        await new Promise((r) => setTimeout(r, 1));
        ctl.enqueue(corpo.subarray(pos, pos + 16_384));
        (this as unknown as { pos?: number }).pos = pos + 16_384;
      }
    });
    init?.signal?.addEventListener("abort", () => stream.cancel().catch(() => {}));
    const headers: Record<string, string> = { "content-length": String(corpo.length) };
    if (inicio > 0) headers["content-range"] = `bytes ${inicio}-${zip.length - 1}/${zip.length}`;
    return new Response(stream, { status: inicio > 0 ? 206 : 200, headers });
  };
  const instancia = () => {
    const root = fs.mkdtempSync(path.join(base, "spt-"));
    fs.mkdirSync(path.join(root, "BepInEx", "plugins"), { recursive: true });
    fs.mkdirSync(path.join(root, "user", "mods"), { recursive: true });
    return root;
  };
  async function pausaNoMeio(tarefa: ReturnType<typeof criarTarefaDeDownload>) {
    const c1 = new AbortController();
    let parouEm = 0;
    await tarefa
      .download(c1.signal, (r) => {
        if (r > 50_000 && !c1.signal.aborted) {
          parouEm = r;
          c1.abort();
        }
      })
      .catch(() => undefined);
    return parouEm;
  }

  for (const [rotulo, cacheLigado] of [["sem cache", false], ["com cache", true]] as const) {
    configureDownloadCache(path.join(base, `cache-${rotulo}`), cacheLigado ? 10 * 1024 * 1024 : 0);
    aceitaRange = true;
    pedidos.length = 0;
    const root = instancia();
    const tarefa = criarTarefaDeDownload(root, root, `https://fonte/pesado-${rotulo}.zip`, "Pesado", { version: "1.0.0" });
    const parouEm = await pausaNoMeio(tarefa);
    check(`${rotulo}: pausou no meio`, parouEm > 0 && parouEm < zip.length, true);
    await tarefa.download(new AbortController().signal, () => {});
    check(`${rotulo}: continuou pedindo só o resto`, [pedidos.length, pedidos[1]?.startsWith("bytes=")], [2, true]);
    check(`${rotulo}: não precisou recomeçar`, tarefa.restarted, false);
    const r = await tarefa.install();
    check(`${rotulo}: arquivo inteiro, instala`, [r.success, fs.readdirSync(path.join(root, "BepInEx", "plugins"))], [true, ["Pesado"]]);
    check(
      `${rotulo}: DLL igual à original`,
      (() => {
        const f = path.join(root, "BepInEx", "plugins", "Pesado", "Pesado.dll");
        return fs.existsSync(f) && fs.readFileSync(f).equals(dll);
      })(),
      true
    );
  }

  {
    configureDownloadCache(path.join(base, "cache-ignora"), 0);
    aceitaRange = false;
    pedidos.length = 0;
    const root = instancia();
    const tarefa = criarTarefaDeDownload(root, root, "https://fonte/ignora.zip", "Pesado", { version: "1.0.0" });
    await pausaNoMeio(tarefa);
    await tarefa.download(new AbortController().signal, () => {});
    check("servidor que ignora Range: recomeça e avisa", tarefa.restarted, true);
    const r = await tarefa.install();
    check("e o arquivo final não fica duplicado", r.success, true);
  }

  {
    configureDownloadCache(path.join(base, "cache-cancela"), 10 * 1024 * 1024);
    aceitaRange = true;
    const root = instancia();
    const tarefa = criarTarefaDeDownload(root, root, "https://fonte/cancela.zip", "Pesado", { version: "1.0.0" });
    await pausaNoMeio(tarefa);
    tarefa.discard();
    const sobras = fs
      .readdirSync(path.join(base, "cache-cancela"))
      .filter((f) => f !== "index.json");
    check("cancelar depois de pausar apaga o pedaço do cache", sobras, []);
    check("e nada fica na pasta do SPT", fs.readdirSync(root).filter((f) => f.startsWith(".tmp-")), []);
  }

  {
    const root = instancia();
    fs.mkdirSync(path.join(root, ".tmp-forge-download-123"));
    fs.writeFileSync(path.join(root, ".tmp-forge-download-123", "X.zip.partial"), "x");
    fs.writeFileSync(path.join(root, ".tmp-forge-download-456-Velho.zip"), "x"); // formato antigo
    fs.mkdirSync(path.join(root, ".tmp-mod-extract-789"));
    check("sobras de download são limpas ao abrir", limparDownloadsInterrompidos(root), 2);
    check("e o resto da pasta fica", fs.readdirSync(root).sort(), [".tmp-mod-extract-789", "BepInEx", "user"]);
  }

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail) process.exit(1);
})();
