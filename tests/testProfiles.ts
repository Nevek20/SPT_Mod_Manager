/** Perfis de mods (electron/profiles.ts). */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { scanMods, loadAliases, loadCustomCategories, loadForgeMatchCache, saveForgeMatchCache, setModAlias, saveCustomCategories } from "../electron/modManager";
import {
  listProfiles,
  createProfile,
  renameProfile,
  deleteProfile,
  switchProfile,
  exportProfile,
  importProfile,
  PROFILE_FORMAT
} from "../electron/profiles";

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "perfis-"));
const raiz = path.join(tmp, "spt");
const plugins = path.join(raiz, "BepInEx", "plugins");
const serverMods = path.join(raiz, "user", "mods");
fs.mkdirSync(plugins, { recursive: true });
fs.mkdirSync(serverMods, { recursive: true });
fs.writeFileSync(path.join(raiz, "SPT.Server.exe"), "");

function servidor(nome: string) {
  fs.mkdirSync(path.join(serverMods, nome), { recursive: true });
  fs.writeFileSync(path.join(serverMods, nome, "package.json"), JSON.stringify({ name: nome, version: "1.0.0", author: "x" }));
}
function cliente(nome: string) {
  fs.writeFileSync(path.join(plugins, `${nome}.dll`), "nao e dll");
}
const estado = () =>
  Object.fromEntries(
    scanMods(raiz, raiz)
      .map((m) => [m.originalName, m.enabled] as const)
      .sort((a, b) => a[0].localeCompare(b[0]))
  );

servidor("SAIN");
servidor("Realism");
cliente("Questing");

console.log("\nprimeira vez");
{
  const l = listProfiles(raiz, raiz);
  check("estado atual vira o perfil Default", l.profiles.map((p) => p.name), ["Default"]);
  check("Default é o ativo", l.active, "default");
  check("conta os mods", [l.profiles[0].modCount, l.profiles[0].enabledCount], [3, 3]);
}

console.log("\ncriar copia o estado e ativa sem mexer no disco");
setModAlias(raiz, "SAIN", "Bots espertos");
const c = createProfile(raiz, raiz, "  Fika   com amigos ");
check("criou", c.success, true);
{
  const l = listProfiles(raiz, raiz);
  check("nome limpo", l.profiles.map((p) => p.name), ["Default", "Fika com amigos"]);
  check("novo é o ativo", l.active, c.id);
  check("disco igual", estado(), { Questing: true, Realism: true, SAIN: true });
}
check("nome repetido ganha sufixo", createProfile(raiz, raiz, "fika com amigos").message, 'Mod profile "fika com amigos (2)" created.');
check("nome vazio recusado", createProfile(raiz, raiz, "   ").success, false);

console.log("\nperfil ativo salva sozinho e troca desativa quem não é membro");
{
  const fika = c.id!;
  // Volta pro Fika (o "(2)" virou ativo ao ser criado)
  check("troca pro Fika", switchProfile(raiz, raiz, fika).success, true);
  // Mexe no Fika: desativa Realism e instala um mod novo
  fs.mkdirSync(path.join(raiz, "user", "mods.disabled"), { recursive: true });
  fs.renameSync(path.join(serverMods, "Realism"), path.join(raiz, "user", "mods.disabled", "Realism"));
  servidor("Fika.Core");
  setModAlias(raiz, "SAIN", "SAIN do Fika");
  saveCustomCategories(raiz, { categories: [{ id: "c1", name: "Essenciais" }], assign: {} });

  const r = switchProfile(raiz, raiz, "default");
  check("troca pro Default", r.success, true);
  check("Fika.Core não é do Default: desativado", r.disabled, ["Fika.Core"]);
  check("Realism volta ativo no Default", estado(), { "Fika.Core": false, Questing: true, Realism: true, SAIN: true });
  check("nome do Default volta", loadAliases(raiz).SAIN, "Bots espertos");
  check("categorias do Default (vazias)", loadCustomCategories(raiz).categories, []);
  check("nada faltando", r.missing, []);

  const r2 = switchProfile(raiz, raiz, fika);
  check("de volta ao Fika: guardou o que foi feito nele", estado(), { "Fika.Core": true, Questing: true, Realism: false, SAIN: true });
  check("nome do Fika", loadAliases(raiz).SAIN, "SAIN do Fika");
  check("categorias do Fika", loadCustomCategories(raiz).categories.map((x) => x.name), ["Essenciais"]);
  check("nada desativado na volta", r2.disabled, []);
}

console.log("\nvínculos manuais vão junto com o perfil");
{
  const ativo = listProfiles(raiz, raiz).active;
  saveForgeMatchCache(raiz, { Questing: { ids: { "sp-mod": "555" }, manual: { "sp-mod": true }, version: "0.9.0" } });
  switchProfile(raiz, raiz, "default");
  check("Default não tem o vínculo", loadForgeMatchCache(raiz).Questing?.manual, undefined);
  switchProfile(raiz, raiz, ativo);
  const q = loadForgeMatchCache(raiz).Questing;
  check("Fika recupera o vínculo", [q?.ids["sp-mod"], q?.manual, q?.version], ["555", { "sp-mod": true }, "0.9.0"]);
}

console.log("\nmod do perfil que sumiu do disco vira 'faltando'");
{
  const ativo = listProfiles(raiz, raiz).active;
  switchProfile(raiz, raiz, "default");
  // Remove o Questing "por fora" enquanto está no Default... e o Default fotografa sem ele
  fs.rmSync(path.join(plugins, "Questing.dll"));
  const r = switchProfile(raiz, raiz, ativo);
  check("Questing faltando no Fika", r.missing.map((m) => m.name), ["Questing"]);
  // O vínculo manual deu id ao mod, então o download vai pelo id exato.
  check("faltando leva o id do catálogo pra baixar", r.missing[0]?.id, 555);
  cliente("Questing");
}

console.log("\nrenomear e excluir");
{
  const l = listProfiles(raiz, raiz);
  check("não exclui o ativo", deleteProfile(raiz, raiz, l.active).success, false);
  const outro = l.profiles.find((p) => p.name === "fika com amigos (2)")!;
  check("renomeia", renameProfile(raiz, raiz, outro.id, "Solo").message, 'Mod profile renamed to "Solo".');
  check("exclui o inativo", deleteProfile(raiz, raiz, outro.id).success, true);
  check("sobrou", listProfiles(raiz, raiz).profiles.map((p) => p.name), ["Default", "Fika com amigos"]);
}

console.log("\nexportar e importar");
{
  const exp = exportProfile(raiz, raiz)!;
  check("formato", [exp.format, exp.formatVersion], [PROFILE_FORMAT, 2]);
  check("mods[].name é o nome original (a 0.7 continua lendo)", exp.mods.map((m) => m.name).sort(), ["Fika.Core", "Questing", "Realism", "SAIN"]);
  check("leva os nomes", exp.aliases.SAIN, "SAIN do Fika");

  const imp = importProfile(raiz, raiz, JSON.parse(JSON.stringify(exp)), "/x/amigo.json");
  check("importa com o nome do perfil, sem repetir", imp.name, "Fika com amigos (2)");
  check("nada faltando, mesmo disco", imp.missingCount, 0);

  // Lista antiga (0.7): sem id, sem enabled em alguns, com um mod que não existe aqui
  const antiga = {
    exportedAt: "2026-01-01T00:00:00Z",
    mods: [
      { name: "SAIN", type: "server", enabled: true, version: "1.0.0" },
      { name: "Questing", type: "client" },
      { name: "NaoTenho", type: "server", enabled: true, guid: "com.x.naotenho", version: "2.0.0" }
    ]
  };
  const imp2 = importProfile(raiz, raiz, antiga, "C:/Downloads/spt-modlist.json");
  check("lista antiga vira perfil com o nome do arquivo", imp2.name, "spt-modlist");
  check("conta o faltando", imp2.missingCount, 1);
  const r = switchProfile(raiz, raiz, imp2.id!);
  check("aplica a lista antiga", estado(), { "Fika.Core": false, Questing: true, Realism: false, SAIN: true });
  check("faltando com guid e versão pra baixar", r.missing, [{ name: "NaoTenho", guid: "com.x.naotenho", version: "2.0.0" }]);

  check("lixo recusado", importProfile(raiz, raiz, { foo: 1 }, "x.json").success, false);
  check(
    "id com barra é descartado",
    importProfile(raiz, raiz, { mods: [{ name: "X", id: "../../evil", type: "server" }] }, "y.json").success,
    true
  );
}

console.log("\narquivo de perfis corrompido");
{
  fs.writeFileSync(path.join(raiz, "user", "spt-mod-manager", "profiles.json"), "{ quebrado");
  const l = listProfiles(raiz, raiz);
  check("recomeça com o estado atual como Default", l.profiles.map((p) => p.name), ["Default"]);
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
