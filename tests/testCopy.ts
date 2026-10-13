/**
 * Cópia por cima de arquivo protegido (relato do mistafreez2023, 0.6.4).
 *
 * "EPERM: operation not permitted, copyfile" num .json de BepInEx/plugins. No
 * Windows: destino somente leitura (dá pra resolver sozinho) ou aberto pelo jogo
 * (não dá, mas a mensagem tem que dizer o que fazer). O contêiner de teste roda
 * como root no Linux, onde somente leitura não barra nada, então o EPERM é
 * simulado trocando o copyFileSync.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { _copiarArquivo } from "../electron/modManager";
import { translateBackendMessage } from "../src/i18n";

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

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-copia-"));
const src = path.join(raiz, "novo.json");
const dest = path.join(raiz, "ScopeRangefinder.presets.json");
fs.writeFileSync(src, "novo");

const original = fs.copyFileSync;
const epermDuasVezes = { restante: 0 };
function falhaComEperm(vezes: number) {
  epermDuasVezes.restante = vezes;
  (fs as { copyFileSync: unknown }).copyFileSync = (a: fs.PathLike, b: fs.PathLike) => {
    if (epermDuasVezes.restante > 0) {
      epermDuasVezes.restante--;
      const e = new Error("EPERM: operation not permitted, copyfile") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    }
    return original(a, b);
  };
}

try {
  console.log("\ncopia normal");
  fs.writeFileSync(dest, "velho");
  _copiarArquivo(src, dest);
  check("sobrescreve", fs.readFileSync(dest, "utf8"), "novo");

  console.log("\nsomente leitura: resolve sozinho");
  fs.writeFileSync(dest, "velho");
  fs.chmodSync(dest, 0o444);
  falhaComEperm(1);
  _copiarArquivo(src, dest);
  check("tenta de novo e copia", fs.readFileSync(dest, "utf8"), "novo");
  check("e tirou o somente leitura", (fs.statSync(dest).mode & 0o222) !== 0, true);

  console.log("\naberto pelo jogo: nao resolve, mas explica");
  falhaComEperm(2);
  let msg = "";
  try {
    _copiarArquivo(src, dest);
  } catch (e) {
    msg = (e as Error).message;
  }
  check(
    "mensagem diz o arquivo e o que fazer",
    msg,
    'Couldn\'t overwrite "ScopeRangefinder.presets.json": the file is read-only or in use. Close the game and the SPT server, then try again. (EPERM)'
  );
  check(
    "e chega traduzida em pt-BR",
    translateBackendMessage("Error installing: " + msg, "pt-BR"),
    'Erro ao instalar: Não deu pra sobrescrever "ScopeRangefinder.presets.json": o arquivo está como somente leitura ou aberto. Feche o jogo e o servidor do SPT e tente de novo. (EPERM)'
  );

  console.log("\noutros erros passam direto");
  (fs as { copyFileSync: unknown }).copyFileSync = () => {
    const e = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
    e.code = "ENOSPC";
    throw e;
  };
  let codigo = "";
  try {
    _copiarArquivo(src, dest);
  } catch (e) {
    codigo = (e as NodeJS.ErrnoException).code ?? "";
  }
  check("disco cheio nao vira mensagem de somente leitura", codigo, "ENOSPC");
} finally {
  (fs as { copyFileSync: unknown }).copyFileSync = original;
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
