/**
 * Cache de downloads (issue #5, 0.7.0) e o nome da pasta de mod com DLL solta.
 *
 * A parte do DownloadCache roda em pasta temporária de verdade. A parte do
 * installForgeModVersion troca o fetch global por um que serve um zip montado
 * aqui, contando quantas vezes a rede foi chamada.
 */

import fs from "fs";
import os from "os";
import path from "path";
import AdmZip from "adm-zip";
import { DownloadCache, chaveDoCache } from "../electron/downloadCache";
import { installForgeModVersion, configureDownloadCache, getDownloadCache } from "../electron/modManager";

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

const base = fs.mkdtempSync(path.join(os.tmpdir(), "spt-cache-"));
let n = 0;
const novaPasta = () => path.join(base, `c${++n}`);

/** Simula um download terminado: arquivo de `bytes` na pasta reservada e commit. */
function baixa(c: DownloadCache, link: string, versao: string, bytes: number, nome = "Mod.zip"): string | undefined {
  const slot = c.slotFor(link, versao, bytes);
  if (!slot) return undefined;
  const arq = path.join(slot, nome);
  fs.writeFileSync(arq, Buffer.alloc(bytes, 1));
  c.commit(link, versao, arq, "Mod");
  return arq;
}

(async () => {
  console.log("Chave e versão");
  {
    const c = new DownloadCache(novaPasta(), 10_000);
    check("sem versão não entra", c.slotFor("https://x/a.zip", undefined, 10), undefined);
    check("sem versão não acha", c.lookup("https://x/a.zip", undefined), undefined);
    const arq = baixa(c, "https://x/a.zip", "1.0.0", 100);
    check("achado depois de gravado", c.lookup("https://x/a.zip", "1.0.0"), arq);
    check("mesmo link, outra versão (link de \"latest\"): não acha", c.lookup("https://x/a.zip", "1.1.0"), undefined);
    check("chave depende de link e versão", chaveDoCache("a", "1") === chaveDoCache("a", "2"), false);
    check("arquivo mora em <chave>/<nome do mod>", path.basename(arq!), "Mod.zip");
  }

  console.log("Integridade");
  {
    const c = new DownloadCache(novaPasta(), 10_000);
    const arq = baixa(c, "https://x/b.zip", "1", 100)!;
    fs.writeFileSync(arq, "mexido por fora");
    check("tamanho diferente: esquece e baixa de novo", c.lookup("https://x/b.zip", "1"), undefined);
    check("e a pasta some", fs.existsSync(path.dirname(arq)), false);
    const arq2 = baixa(c, "https://x/c.zip", "1", 100)!;
    fs.rmSync(arq2);
    check("arquivo apagado por fora: esquece", c.lookup("https://x/c.zip", "1"), undefined);
    check("info sem fantasma", c.info().count, 0);
  }

  console.log("Limite");
  {
    const c = new DownloadCache(novaPasta(), 1000);
    baixa(c, "https://x/1", "1", 400);
    baixa(c, "https://x/2", "1", 400);
    c.lookup("https://x/1", "1"); // o 1 foi usado agora, o 2 é o mais velho
    baixa(c, "https://x/3", "1", 400);
    check("passou do limite: sai o usado há mais tempo", [!!c.lookup("https://x/1", "1"), !!c.lookup("https://x/2", "1"), !!c.lookup("https://x/3", "1")], [true, false, true]);
    check("uso dentro do limite", c.info().usedBytes <= 1000, true);
    check("maior que o limite inteiro nem reserva pasta", c.slotFor("https://x/grande", "1", 5000), undefined);
    const slot = c.slotFor("https://x/sem-tamanho", "1", 0)!;
    fs.writeFileSync(path.join(slot, "G.zip"), Buffer.alloc(5000));
    c.commit("https://x/sem-tamanho", "1", path.join(slot, "G.zip"), "G");
    check("sem content-length e grande demais: descartado no commit", [c.lookup("https://x/sem-tamanho", "1"), fs.existsSync(slot)], [undefined, false]);
  }

  console.log("Em uso");
  {
    const c = new DownloadCache(novaPasta(), 1000);
    baixa(c, "https://x/a", "1", 400);
    c.acquire("https://x/a", "1");
    baixa(c, "https://x/b", "1", 400);
    baixa(c, "https://x/c", "1", 400);
    check("o que está em uso não sai pelo limite", !!c.lookup("https://x/a", "1"), true);
    const r = c.clear();
    check("nem pelo Limpar cache", [r.kept, !!c.lookup("https://x/a", "1")], [1, true]);
    c.release("https://x/a", "1");
    check("solto, sai normalmente", [c.clear().removed, c.info().count], [1, 0]);
  }

  console.log("Desligar");
  {
    const dir = novaPasta();
    const c = new DownloadCache(dir, 1000);
    baixa(c, "https://x/a", "1", 100);
    c.setLimit(0);
    check("desligado apaga tudo", [c.info().count, c.enabled], [0, false]);
    check("e não acha nem reserva mais", [c.lookup("https://x/a", "1"), c.slotFor("https://x/a", "1", 1)], [undefined, undefined]);
    c.setLimit(1000);
    check("religado volta a funcionar", !!baixa(c, "https://x/a", "1", 100), true);
  }

  console.log("Reabrir o app");
  {
    const dir = novaPasta();
    const c = new DownloadCache(dir, 10_000);
    baixa(c, "https://x/a", "1", 100);
    // Sobra de download interrompido, pasta que não é nossa e índice adulterado.
    const orfa = path.join(dir, "0123456789abcdef0123456789abcdef");
    fs.mkdirSync(orfa);
    fs.writeFileSync(path.join(orfa, "Meio.zip.partial"), "x");
    fs.mkdirSync(path.join(dir, "nao-e-do-cache"));
    const indice = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8"));
    indice.entries["fedcba9876543210fedcba9876543210"] = { file: "../../fora.txt", size: 1, link: "x", version: "1" };
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(indice));

    const c2 = new DownloadCache(dir, 10_000);
    check("o que estava gravado continua", !!c2.lookup("https://x/a", "1"), true);
    check("download interrompido é limpo", fs.existsSync(orfa), false);
    check("pasta que não é do cache fica", fs.existsSync(path.join(dir, "nao-e-do-cache")), true);
    check("caminho adulterado no índice é ignorado", c2.info().count, 1);
    fs.writeFileSync(path.join(dir, "index.json"), "{ quebrado");
    check("índice quebrado não derruba nada", new DownloadCache(dir, 10_000).info().count, 0);
  }

  console.log("Download de verdade (fetch simulado)");
  const zipBom = (() => {
    const z = new AdmZip();
    z.addFile("LooseMod.dll", Buffer.from("MZ fake dll"));
    z.addFile("readme.txt", Buffer.from("leia"));
    return z.toBuffer();
  })();
  let chamadas = 0;
  let servir: () => Response = () => new Response(zipBom, { headers: { "content-length": String(zipBom.length) } });
  (globalThis as { fetch: unknown }).fetch = async () => {
    chamadas++;
    return servir();
  };
  const instancia = () => {
    const root = path.join(base, `spt${++n}`);
    fs.mkdirSync(path.join(root, "BepInEx", "plugins"), { recursive: true });
    fs.mkdirSync(path.join(root, "user", "mods"), { recursive: true });
    return root;
  };
  const progresso: { de: boolean[] } = { de: [] };
  const instala = (root: string, link: string, versao?: string) =>
    installForgeModVersion(root, root, link, "LooseMod", (_r, _t, fromCache) => progresso.de.push(!!fromCache), {
      id: 1,
      name: "LooseMod",
      version: versao
    });

  const dirCache = novaPasta();
  configureDownloadCache(dirCache, 1024 * 1024);
  {
    const root = instancia();
    const r1 = await instala(root, "https://fonte/loose-1.0.zip", "1.0.0");
    check("primeira vez baixa e instala", [r1.success, chamadas, r1.fromCache ?? false], [true, 1, false]);
    check(
      "DLL solta vira pasta com o nome do mod, não do temporário",
      fs.readdirSync(path.join(root, "BepInEx", "plugins")),
      ["LooseMod"]
    );
    check("nada de temporário sobrando na pasta do SPT", fs.readdirSync(root).filter((f) => f.startsWith(".tmp-")), []);

    const root2 = instancia();
    progresso.de = [];
    const r2 = await instala(root2, "https://fonte/loose-1.0.zip", "1.0.0");
    check("segunda vez vem do cache, sem rede", [r2.success, chamadas, r2.fromCache], [true, 1, true]);
    check("progresso avisa que é do cache", progresso.de, [true]);
    check("instalou igual", fs.readdirSync(path.join(root2, "BepInEx", "plugins")), ["LooseMod"]);

    const r3 = await instala(instancia(), "https://fonte/loose-1.0.zip", "1.1.0");
    check("versão nova no mesmo link baixa de novo", [r3.success, chamadas], [true, 2]);

    const r4 = await instala(instancia(), "https://fonte/sem-versao.zip", undefined);
    check("sem versão baixa sempre e não guarda", [r4.success, chamadas, getDownloadCache()!.info().count], [true, 3, 2]);
  }
  {
    servir = () => new Response(zipBom.subarray(0, 20), { headers: { "content-length": String(zipBom.length) } });
    const antes = getDownloadCache()!.info().count;
    const r = await instala(instancia(), "https://fonte/cortado.zip", "1.0.0");
    check("download cortado falha", r.success, false);
    check("e não entra no cache", getDownloadCache()!.info().count, antes);
    const parciais = fs
      .readdirSync(dirCache, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => fs.readdirSync(path.join(dirCache, d.name)))
      .filter((f) => f.endsWith(".partial"));
    check("nem sobra .partial na pasta do cache", parciais, []);
    check("pasta da chave cortada não existe", fs.existsSync(path.join(dirCache, chaveDoCache("https://fonte/cortado.zip", "1.0.0"))), false);
  }
  {
    servir = () => new Response(Buffer.from("isto não é um zip"), { headers: { "content-length": "17" } });
    const r = await instala(instancia(), "https://fonte/quebrado.zip", "1.0.0");
    check("arquivo que não instala falha", r.success, false);
    check("e não fica no cache", fs.existsSync(path.join(dirCache, chaveDoCache("https://fonte/quebrado.zip", "1.0.0"))), false);
  }
  {
    servir = () => new Response(zipBom, { headers: { "content-length": String(zipBom.length) } });
    configureDownloadCache(novaPasta(), 0);
    const antes = chamadas;
    const root = instancia();
    const r1 = await instala(root, "https://fonte/loose-1.0.zip", "1.0.0");
    const r2 = await instala(instancia(), "https://fonte/loose-1.0.zip", "1.0.0");
    check("cache desligado: baixa toda vez", [r1.success, r2.success, chamadas - antes], [true, true, 2]);
    check("e limpa o temporário", fs.readdirSync(root).filter((f) => f.startsWith(".tmp-")), []);
    check("com o nome certo também", fs.readdirSync(path.join(root, "BepInEx", "plugins")), ["LooseMod"]);
  }

  fs.rmSync(base, { recursive: true, force: true });
  console.log(`\n${ok} ok, ${fail} falha(s)`);
  if (fail) process.exit(1);
})();
