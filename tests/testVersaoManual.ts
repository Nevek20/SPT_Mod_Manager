/**
 * Versão informada à mão (relato do raydenx, 0.8.0):
 * 1. dá pra informar só a versão, sem mexer no vínculo com a página;
 * 2. atualizar pelo catálogo apaga a versão informada, senão o mod continuava
 *    na versão velha e a checagem oferecia a mesma atualização pra sempre.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import AdmZip from "adm-zip";
import {
  scanMods,
  setManualVersion,
  saveForgeMatchCache,
  loadForgeMatchCache,
  installModFromArchive,
  nomeOriginalDaPasta
} from "../electron/modManager";

let ok = 0,
  fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         esperado ${JSON.stringify(want)}\n         obtido   ${JSON.stringify(got)}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "versao-"));
const raiz = path.join(tmp, "spt");
fs.mkdirSync(path.join(raiz, "BepInEx", "plugins"), { recursive: true });
fs.mkdirSync(path.join(raiz, "user", "mods"), { recursive: true });
fs.writeFileSync(path.join(raiz, "SPT.Server.exe"), "");
fs.writeFileSync(path.join(raiz, "BepInEx", "plugins", "SemVersao.dll"), "nao e dll de verdade");
const mod = () => scanMods(raiz, raiz).find((m) => m.id === "SemVersao.dll");

(async () => {
  console.log("\nnome da chave do cache");
  check("client: dll sem extensão", nomeOriginalDaPasta("SemVersao.dll", "client"), "SemVersao");
  check("server: sem prefixo de ordem", nomeOriginalDaPasta("03_MeuMod", "server"), "MeuMod");

  console.log("\nsó a versão, sem vínculo");
  // O app já reconhece o mod no catálogo (casamento automático, id 4242).
  saveForgeMatchCache(raiz, { SemVersao: { ids: { "sp-mod": "4242" } } });
  check("sem versão antes", mod()?.version, undefined);
  setManualVersion(raiz, "SemVersao", " 1.0.0 ");
  check("versão informada aparece", mod()?.version, "1.0.0");
  check("marcada como informada à mão", mod()?.versionManual, true);
  check("o casamento automático continua (não vira vínculo manual)", loadForgeMatchCache(raiz).SemVersao?.manual, undefined);
  check("id do catálogo continua", mod()?.forgeModId, 4242);
  setManualVersion(raiz, "SemVersao", "");
  check("vazio apaga a versão informada", mod()?.version, undefined);

  console.log("\natualizar pelo catálogo apaga a versão informada");
  setManualVersion(raiz, "SemVersao", "1.0.0");
  const arquivo = path.join(tmp, "SemVersao-2.0.0.zip");
  const zip = new AdmZip();
  zip.addFile("BepInEx/plugins/SemVersao.dll", Buffer.from("nova versao"));
  zip.writeZip(arquivo);
  const r = await installModFromArchive(raiz, raiz, arquivo, "SemVersao", { name: "Sem Versão", version: "2.0.0", id: 4242 });
  check("instalou", r.success, true);
  check("a versão nova passa a valer", mod()?.version, "2.0.0");
  check("e não é mais 'informada à mão'", mod()?.versionManual, undefined);
  check("o id do catálogo continua", loadForgeMatchCache(raiz).SemVersao?.ids["sp-mod"], "4242");

  console.log("\ninstalação sem versão conhecida não apaga nada");
  setManualVersion(raiz, "SemVersao", "2.0.1");
  const arquivo2 = path.join(tmp, "SemVersao-local.zip");
  const zip2 = new AdmZip();
  zip2.addFile("BepInEx/plugins/SemVersao.dll", Buffer.from("instalado a mao"));
  zip2.writeZip(arquivo2);
  await installModFromArchive(raiz, raiz, arquivo2);
  check("arquivo local mantém a versão informada", mod()?.version, "2.0.1");

  console.log(`\n${ok} ok, ${fail} falhas\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
