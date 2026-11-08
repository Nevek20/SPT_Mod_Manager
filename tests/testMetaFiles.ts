/**
 * 0.7.1: arquivos de dados em user/spt-mod-manager (com migração dos da raiz),
 * leitura do "Vincular à página do mod", formato real do arquivo baixado e
 * mensagem de erro de rede.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getMetaDir,
  metaPath,
  legacyMetaPath,
  setModAlias,
  scanMods,
  loadForgeMatchCache,
  saveForgeMatchCache,
  clearManualForgeMatch,
  parseForgeModReference,
  detectArchiveFormat
} from "../electron/modManager";
import { describeNetworkError } from "../electron/http";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meta-"));

console.log("\npasta nova, instância simples");
{
  const raiz = path.join(tmp, "simples");
  fs.mkdirSync(path.join(raiz, "BepInEx", "plugins"), { recursive: true });
  fs.mkdirSync(path.join(raiz, "user", "mods"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "SPT.Server.exe"), "");
  check("fica em <raiz>/user/spt-mod-manager", getMetaDir(raiz), path.join(raiz, "user", "spt-mod-manager"));
  setModAlias(raiz, "SAIN", "Meu SAIN");
  check("grava o alias na pasta nova", fs.existsSync(path.join(raiz, "user", "spt-mod-manager", "aliases.json")), true);
  check("nada novo na raiz", fs.readdirSync(raiz).filter((n) => n.startsWith(".spt-mod-manager")), []);
}

console.log("\nlayout dividido do 4.1 (servidor em SPT_Runtime)");
{
  const jogo = path.join(tmp, "dividido");
  fs.mkdirSync(path.join(jogo, "BepInEx", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(jogo, "EscapeFromTarkov.exe"), "");
  fs.mkdirSync(path.join(jogo, "SPT_Runtime", "user", "mods"), { recursive: true });
  fs.writeFileSync(path.join(jogo, "SPT_Runtime", "SPT.Server.exe"), "");
  check(
    "vai pro user/ do servidor, não cria user/ na raiz do jogo",
    getMetaDir(jogo),
    path.join(jogo, "SPT_Runtime", "user", "spt-mod-manager")
  );
  setModAlias(jogo, "X", "Y");
  check("raiz do jogo continua sem user/", fs.existsSync(path.join(jogo, "user")), false);
}

console.log("\nmigração dos arquivos da 0.7.0");
{
  const raiz = path.join(tmp, "antiga");
  fs.mkdirSync(path.join(raiz, "BepInEx", "plugins"), { recursive: true });
  fs.mkdirSync(path.join(raiz, "user", "mods", "SAIN"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "SPT.Server.exe"), "");
  fs.writeFileSync(legacyMetaPath(raiz, "aliases"), JSON.stringify({ SAIN: "Apelido antigo" }));
  fs.writeFileSync(legacyMetaPath(raiz, "forge-match"), JSON.stringify({ SAIN: { ids: { "sp-mod": "791" } } }));
  const mods = scanMods(raiz, raiz);
  check("alias antigo continua valendo", mods.find((m) => m.id === "SAIN")?.name, "Apelido antigo");
  check("arquivo antigo saiu da raiz", fs.existsSync(legacyMetaPath(raiz, "aliases")), false);
  check("e foi pra pasta nova", fs.existsSync(metaPath(raiz, "aliases")), true);
  check("cache de casamento migrado", loadForgeMatchCache(raiz).SAIN?.ids, { "sp-mod": "791" });
  check("raiz limpa", fs.readdirSync(raiz).filter((n) => n.startsWith(".spt-mod-manager")), []);
}

console.log("\nnovo ganha do antigo quando os dois existem");
{
  const raiz = path.join(tmp, "dois");
  fs.mkdirSync(path.join(raiz, "user"), { recursive: true });
  fs.writeFileSync(legacyMetaPath(raiz, "aliases"), JSON.stringify({ A: "velho" }));
  fs.mkdirSync(getMetaDir(raiz), { recursive: true });
  fs.writeFileSync(path.join(getMetaDir(raiz), "aliases.json"), JSON.stringify({ A: "novo" }));
  check("lê o novo", JSON.parse(fs.readFileSync(metaPath(raiz, "aliases"), "utf-8")).A, "novo");
}

console.log("\nvínculo manual");
{
  const raiz = path.join(tmp, "manual");
  fs.mkdirSync(path.join(raiz, "BepInEx", "plugins"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "BepInEx", "plugins", "SemVersao.dll"), "nao e um dll de verdade");
  fs.mkdirSync(path.join(raiz, "user", "mods"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "SPT.Server.exe"), "");
  saveForgeMatchCache(raiz, {
    SemVersao: { ids: { "sp-mod": "1234" }, manual: { "sp-mod": true }, version: "2.0.1" }
  });
  const relido = loadForgeMatchCache(raiz).SemVersao;
  check("manual sobrevive ao reler", relido.manual, { "sp-mod": true });
  check("versão sobrevive ao reler", relido.version, "2.0.1");
  const mod = scanMods(raiz, raiz).find((m) => m.id === "SemVersao.dll");
  check("scan usa a versão informada", mod?.version, "2.0.1");
  check("marca como versão manual", mod?.versionManual, true);
  check("marca como vínculo manual", mod?.forgeLinkManual, true);
  check("id do catálogo vem do vínculo", mod?.forgeModId, 1234);
  clearManualForgeMatch(raiz, "SemVersao");
  const depois = scanMods(raiz, raiz).find((m) => m.id === "SemVersao.dll");
  check("desvincular tira a versão", depois?.version, undefined);
  check("e o id escolhido", depois?.forgeModId, undefined);
}

console.log("\nleitura do endereço colado");
check("id puro", parseForgeModReference(" 791 "), { id: 791 });
check("sp-mod com slug", parseForgeModReference("https://sp-mod.com/mod/791/sain"), { id: 791, slug: "sain" });
check("com âncora", parseForgeModReference("https://sp-mod.com/mod/2851/spt-mod-manager#versions"), { id: 2851, slug: "spt-mod-manager" });
check("forge alt só com slug", parseForgeModReference("https://forge-alt.katrinfoxvr.com/mods/Wedge"), { slug: "wedge" });
check("caminho sem domínio", parseForgeModReference("/mods/123"), { id: 123 });
check("vazio", parseForgeModReference("   "), null);
check("lixo", parseForgeModReference("https://sp-mod.com/"), null);
check("zero não é id", parseForgeModReference("0"), null);

console.log("\nformato real do arquivo");
{
  const w = (nome: string, bytes: Buffer | string) => {
    const f = path.join(tmp, nome);
    fs.writeFileSync(f, bytes);
    return f;
  };
  check("zip", detectArchiveFormat(w("a.bin", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))), ".zip");
  check("7z com nome de .zip", detectArchiveFormat(w("b.zip", Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]))), ".7z");
  check("rar", detectArchiveFormat(w("c.zip", Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0]))), ".rar");
  check("página html", detectArchiveFormat(w("d.zip", "\n  <!DOCTYPE html><html>")), "html");
  check("vazio", detectArchiveFormat(w("e.zip", "")), "empty");
  check("desconhecido deixa a extensão decidir", detectArchiveFormat(w("f.zip", "MZ....")), null);
}

console.log("\nmensagem de erro de rede");
{
  const erro = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
  check("mostra código e host", describeNetworkError(erro, "https://sp-mod.com/api/v0/ping"), "fetch failed (ECONNRESET, sp-mod.com)");
  check(
    "erro do chromium já traz o código",
    describeNetworkError(new Error("net::ERR_CONNECTION_RESET"), "https://files.sp-mod.com/x.zip"),
    "net::ERR_CONNECTION_RESET (files.sp-mod.com)"
  );
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
