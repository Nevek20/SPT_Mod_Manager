/**
 * Escolha do nível a partir do qual copiar um arquivo extraído.
 *
 * O bug real: o SVM vem como `SPT_Runtime/user/mods/...` mais um `Greed.exe`
 * solto na raiz do .zip. A busca descia até a pasta que tinha `user`, o mod
 * instalava certo, e o executável — que estava um nível acima — nunca era
 * copiado. Nenhum erro aparecia, porque nada no caminho sabia que ele existia.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { _findMergeRoot as findMergeRoot } from "../electron/modManager";

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

/** Monta uma árvore a partir de caminhos; termina em "/" para pasta. */
function monta(caminhos: string[]): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-zip-"));
  for (const c of caminhos) {
    const alvo = path.join(raiz, c);
    if (c.endsWith("/")) fs.mkdirSync(alvo, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, "x");
    }
  }
  return raiz;
}

const rel = (raiz: string, r: string | null) => (r === null ? null : path.relative(raiz, r).replace(/\\/g, "/") || ".");

console.log("\no caso SVM");
{
  const raiz = monta(["SPT_Runtime/user/mods/SVM/package.json", "Greed.exe"]);
  check("comeca na raiz do zip, pra levar o .exe junto", rel(raiz, findMergeRoot(raiz)), ".");
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log("\nsem arquivo solto, desce como antes");
{
  const raiz = monta(["SPT_Runtime/user/mods/SVM/package.json"]);
  check("embrulho sem nada solto: desce ate o nivel do user", rel(raiz, findMergeRoot(raiz)), "SPT_Runtime");
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log("\ncasos que ja funcionavam nao podem mudar");
{
  const raiz = monta(["user/mods/MeuMod/package.json", "BepInEx/plugins/MeuMod.dll"]);
  check("user e BepInEx ja na raiz", rel(raiz, findMergeRoot(raiz)), ".");
  fs.rmSync(raiz, { recursive: true, force: true });
}
{
  const raiz = monta(["user/mods/MeuMod/package.json", "readme.txt"]);
  check("arquivo solto ao lado do user: a raiz ja era o alvo", rel(raiz, findMergeRoot(raiz)), ".");
  fs.rmSync(raiz, { recursive: true, force: true });
}
{
  const raiz = monta(["MeuMod-1.0/BepInEx/plugins/MeuMod.dll"]);
  check("embrulho comum com BepInEx", rel(raiz, findMergeRoot(raiz)), "MeuMod-1.0");
  fs.rmSync(raiz, { recursive: true, force: true });
}
{
  const raiz = monta(["plugins/MeuMod.dll", "MeuMod.dll"]);
  check("sem user nem BepInEx em lugar nenhum devolve null", findMergeRoot(raiz), null);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log("\nnivel intermediario");
{
  // Solto no meio do caminho, nao na raiz: a fusao comeca onde o arquivo esta.
  const raiz = monta(["pacote/SPT_Runtime/user/mods/X/package.json", "pacote/Greed.exe"]);
  check("comeca no nivel que tem o arquivo solto", rel(raiz, findMergeRoot(raiz)), "pacote");
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log("\nlimite de profundidade");
{
  const fundo = "a/b/c/d/e/f/g/user/mods/X/package.json";
  const raiz = monta([fundo]);
  check("nao desce indefinidamente", findMergeRoot(raiz), null);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
