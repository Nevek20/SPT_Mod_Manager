/**
 * VERIFICAÇÃO dos DOIS lados, com cruzamento de GUID.
 *
 * O verificaMetadata.ts original só olhava user/mods. Este cobre server E
 * client e faz a pergunta que decide o próximo passo da feature: das
 * dependências declaradas, quantas apontam pra um mod que está instalado?
 *
 * O que a resposta muda: se muitas apontarem pra fora, um aviso ingênuo de
 * "dependência faltando" vira ruído em dezenas de linhas. Três suspeitos já
 * conhecidos do levantamento:
 *
 *   com.SPT.core      -> é o próprio SPT, não um mod. Todo mod do DrakiaXYZ cita
 *   com.fika.core     -> Fika (multiplayer), quase sempre declarado como SOFT
 *   com.fika.headless -> idem
 *
 * Só lê. Uso:
 *   npx tsx verificaMetadata2.ts
 *   npx tsx verificaMetadata2.ts "C:/SPT"
 */

import fs from "fs";
import path from "path";
import { readDllModMetadata, ModDependency } from "../electron/modManager";

function raizDaConfig(): string | null {
  const appData = process.env.APPDATA ?? (process.env.HOME ? path.join(process.env.HOME, ".config") : null);
  if (!appData) return null;
  for (const nome of ["SPT Mod Manager", "spt-mod-manager", "Electron"]) {
    const cfg = path.join(appData, nome, "config.json");
    if (!fs.existsSync(cfg)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(cfg, "utf-8"));
      const p = d.sptPath || d.serverRoot;
      if (p && fs.existsSync(p)) return String(p);
    } catch {
      /* segue */
    }
  }
  return null;
}

function dllsDe(dir: string): string[] {
  const out: string[] = [];
  const anda = (d: string, prof: number) => {
    if (prof > 3) return;
    let ent: fs.Dirent[];
    try {
      ent = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ent) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) anda(p, prof + 1);
      else if (e.name.toLowerCase().endsWith(".dll")) out.push(p);
    }
  };
  anda(dir, 0);
  return out;
}

interface Mod {
  pasta: string;
  lado: "server" | "client";
  guid?: string;
  versao?: string;
  deps: ModDependency[];
  opcionais: string[];
  incompat: string[];
}

const raiz = process.argv.slice(2).join(" ").trim().replace(/\\/g, "/") || raizDaConfig() || "";
if (!raiz || !fs.existsSync(raiz)) {
  console.error("nao achei a instancia. passe o caminho como argumento.");
  process.exit(1);
}

const dirServer = [
  path.join(raiz, "user", "mods"),
  path.join(raiz, "SPT_Runtime", "user", "mods"),
  path.join(raiz, "SPT", "user", "mods")
].find((p) => fs.existsSync(p));
const dirClient = [path.join(raiz, "BepInEx", "plugins")].find((p) => fs.existsSync(p));

console.log(`\nserver: ${dirServer ?? "NAO ENCONTRADO"}`);
console.log(`client: ${dirClient ?? "NAO ENCONTRADO"}\n`);

const mods: Mod[] = [];

function absorve(dllPath: string, pasta: string, lado: "server" | "client"): Mod {
  const m = readDllModMetadata(dllPath, lado);
  return {
    pasta,
    lado,
    guid: m.guid,
    versao: m.version,
    deps: m.dependencies ?? [],
    opcionais: m.optionalDependencies ?? [],
    incompat: m.incompatibilities ?? []
  };
}

if (dirServer) {
  for (const e of fs.readdirSync(dirServer, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    let melhor: Mod = { pasta: e.name, lado: "server", deps: [], opcionais: [], incompat: [] };
    let pontos = -1;
    for (const dll of dllsDe(path.join(dirServer, e.name))) {
      const m = absorve(dll, e.name, "server");
      const p = (m.guid ? 2 : 0) + m.deps.length;
      if (p > pontos) {
        pontos = p;
        melhor = m;
      }
    }
    mods.push(melhor);
  }
}

if (dirClient) {
  // No client, cada DLL é um plugin: um mod pode ter vários, cada um com suas
  // próprias dependências. Então não escolhemos "o melhor" — todos entram.
  for (const dll of dllsDe(dirClient)) {
    // Plugin solto na raiz de plugins/ nao tem pasta propria, entao o nome do
    // arquivo e o unico rotulo util — senao vira tudo "plugins".
    const pai = path.dirname(dll);
    const rotulo =
      path.resolve(pai) === path.resolve(dirClient)
        ? path.basename(dll, ".dll")
        : `${path.basename(pai)}/${path.basename(dll, ".dll")}`;
    const m = absorve(dll, rotulo, "client");
    if (m.guid || m.deps.length > 0 || m.opcionais.length > 0) mods.push(m);
  }
}

const guidsInstalados = new Map<string, Mod>();
for (const m of mods) if (m.guid) guidsInstalados.set(m.guid.toLowerCase(), m);

const server = mods.filter((m) => m.lado === "server");
const client = mods.filter((m) => m.lado === "client");

console.log("=".repeat(78));
console.log(`server: ${server.length} pastas, ${server.filter((m) => m.guid).length} com GUID`);
console.log(`client: ${client.length} plugins, ${client.filter((m) => m.guid).length} com GUID`);
console.log(`GUIDs unicos indexados: ${guidsInstalados.size}`);
console.log("=".repeat(78));

// --- A pergunta que decide o passo 3 -----------------------------------------
interface Aponta {
  de: Mod;
  guid: string;
  constraint?: string;
  tipo: "obrigatoria" | "opcional";
}
const apontamentos: Aponta[] = [];
for (const m of mods) {
  for (const d of m.deps) apontamentos.push({ de: m, guid: d.guid, constraint: d.constraint, tipo: "obrigatoria" });
  for (const g of m.opcionais) apontamentos.push({ de: m, guid: g, tipo: "opcional" });
}

const resolve = (g: string) => guidsInstalados.get(g.toLowerCase());
const obrig = apontamentos.filter((a) => a.tipo === "obrigatoria");
const opc = apontamentos.filter((a) => a.tipo === "opcional");
const obrigOk = obrig.filter((a) => resolve(a.guid));
const obrigFora = obrig.filter((a) => !resolve(a.guid));

console.log("\n" + "=".repeat(78));
console.log("CRUZAMENTO — e aqui que se decide o desenho do aviso");
console.log("=".repeat(78));
console.log(`  dependencias OBRIGATORIAS declaradas : ${obrig.length}`);
console.log(`     apontam pra mod instalado         : ${obrigOk.length}`);
console.log(`     NAO resolvem                      : ${obrigFora.length}  <- viraria "faltando"`);
console.log(`  dependencias OPCIONAIS (soft)        : ${opc.length}  (nunca devem virar aviso)`);

// Quem sao os alvos que nao resolvem, agrupados: se poucos GUIDs explicam
// muitos apontamentos, uma lista de excecao resolve o ruido inteiro.
const porAlvo = new Map<string, number>();
for (const a of obrigFora) porAlvo.set(a.guid, (porAlvo.get(a.guid) ?? 0) + 1);

console.log("\nALVOS QUE NAO RESOLVEM (quantos mods apontam pra cada):");
for (const [g, n] of [...porAlvo].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}x  ${g}`);
}
console.log("\n  Se os primeiros da lista forem poucos e sempre os mesmos (SPT, Fika),");
console.log("  uma lista de excecao mata quase todo o ruido. Se for uma cauda longa de");
console.log("  GUIDs variados, o problema e outro: sao mods instalados cujo GUID a");
console.log("  gente nao consegue ler, e o aviso teria que ser mais macio.");

const opcPorAlvo = new Map<string, number>();
for (const a of opc) opcPorAlvo.set(a.guid, (opcPorAlvo.get(a.guid) ?? 0) + 1);
if (opcPorAlvo.size > 0) {
  console.log("\nALVOS OPCIONAIS (soft), so pra referencia:");
  for (const [g, n] of [...opcPorAlvo].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    const onde = resolve(g) ? "instalado" : "nao instalado";
    console.log(`  ${String(n).padStart(3)}x  ${g.padEnd(38)} ${onde}`);
  }
}

console.log("\n" + "=".repeat(78));
console.log("DEPENDENCIAS QUE RESOLVEM (o caso feliz — o chip vai mostrar isso)");
console.log("=".repeat(78));
for (const a of obrigOk) {
  const alvo = resolve(a.guid)!;
  console.log(`  ${a.de.pasta.slice(0, 34).padEnd(34)} precisa de ${alvo.pasta} ${a.constraint ?? ""}`);
}

// O caso que a interface tem que tratar: desativar um mod que outros usam.
const dependentes = new Map<string, string[]>();
for (const a of obrigOk) {
  const alvo = resolve(a.guid)!;
  const lista = dependentes.get(alvo.pasta) ?? [];
  if (!lista.includes(a.de.pasta)) lista.push(a.de.pasta);
  dependentes.set(alvo.pasta, lista);
}
console.log("\n" + "=".repeat(78));
console.log("MODS QUE OUTROS DEPENDEM (a pergunta em cascata apareceria nestes)");
console.log("=".repeat(78));
if (dependentes.size === 0) console.log("  nenhum");
for (const [alvo, lista] of [...dependentes].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${alvo}  <- ${lista.length} mod(s)`);
  for (const d of lista) console.log(`      ${d}`);
}
console.log("");
