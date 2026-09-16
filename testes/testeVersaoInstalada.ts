/**
 * Qual versão o app considera instalada.
 *
 * Relato do mozekuma: o aviso de atualização voltava mesmo depois de atualizar.
 * A causa é que a versão lida do DLL ganhava da que a fonte informou, e as duas
 * nem sempre coincidem — autor que esquece de subir o número dentro do assembly
 * faz o app comparar 4.1.0 (DLL) com 4.2.1 (fonte) pra sempre, e atualizar não
 * muda o que está escrito no DLL.
 *
 * Agora, pra mod instalado PELO APP, a fonte manda. Pra mod colocado à mão não
 * existe registro, e o DLL continua sendo a única fonte.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { scanMods } from "../electron/modManager";

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

/** Instância falsa com um mod de server e o registro que o descreve. */
function monta(registro: unknown[], versaoNoDll?: string): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-ver-"));
  const dir = path.join(raiz, "user", "mods", "MeuMod");
  fs.mkdirSync(dir, { recursive: true });

  if (versaoNoDll) {
    // DLL sintético com o bloco ModMetadata no formato 4.0 (sem rótulos).
    const ser = (txt: string) => Buffer.from(txt, "utf16le");
    const vazio = Buffer.alloc(8);
    const partes = ["ModMetadata", " { ", "com.teste.meumod", "Meu Mod", "Autor", versaoNoDll, "~4.1.0", "MIT"];
    fs.writeFileSync(
      path.join(dir, "MeuMod.dll"),
      Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62), ...partes.flatMap((p) => [ser(p), vazio])])
    );
  } else {
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
  }

  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-registry.json"), JSON.stringify(registro));
  return raiz;
}

const versaoDe = (raiz: string) => scanMods(raiz, raiz).find((m) => m.id === "MeuMod")?.version;

// ---------------------------------------------------------------------------
console.log("\ninstalado pelo app: a fonte manda");
// ---------------------------------------------------------------------------
{
  // O caso do relato: DLL parado numa versão antiga, fonte com a atual.
  const raiz = monta(
    [{ id: "MeuMod", type: "server", source: "archive-install", forgeVersion: "4.2.1" }],
    "4.1.0"
  );
  check("versao da fonte ganha da lida no DLL", versaoDe(raiz), "4.2.1");
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta([{ id: "MeuMod", type: "server", source: "archive-install", forgeVersion: "2.0.0" }]);
  check("sem DLL, usa a da fonte igual", versaoDe(raiz), "2.0.0");
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  // Registro do app mas SEM versao gravada: o DLL volta a ser a unica fonte.
  const raiz = monta([{ id: "MeuMod", type: "server", source: "archive-install" }], "3.3.3");
  check("registro sem versao cai no DLL", versaoDe(raiz), "3.3.3");
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\ninstalado a mao: o DLL manda");
// ---------------------------------------------------------------------------
{
  const raiz = monta([{ id: "MeuMod", type: "server", source: "manual", forgeVersion: "9.9.9" }], "1.2.3");
  check("source manual nao deixa a fonte atropelar o DLL", versaoDe(raiz), "1.2.3");
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta([], "1.2.3");
  check("sem registro nenhum, o DLL manda", versaoDe(raiz), "1.2.3");
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta([]);
  check("sem registro e sem DLL, fica sem versao", versaoDe(raiz), undefined);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
