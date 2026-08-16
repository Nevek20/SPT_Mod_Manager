import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadForgeMatchCache, cachedIdFor, saveForgeMatchCache } from "./electron/modManager";

let ok = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperado ${JSON.stringify(want)}\n         obtido   ${JSON.stringify(got)}`); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-"));
const FILE = ".spt-mod-manager-forge-match.json";
const write = (obj: unknown) => fs.writeFileSync(path.join(dir, FILE), JSON.stringify(obj), "utf-8");

console.log("\nmigracao do formato antigo");
write({ SAIN: "791", Wedge: "1204" });
{
  const c = loadForgeMatchCache(dir);
  check("id solto vira entrada legada", c.SAIN, { ids: { "legacy-forge": "791" } });
  check("sp-mod herdou a numeracao, entao aproveita", cachedIdFor(c.SAIN, "sp-mod"), "791");
  check("forge-alt tambem", cachedIdFor(c.SAIN, "forge-alt"), "791");
  check("fonte desconhecida NAO aproveita id legado", cachedIdFor(c.SAIN, "fonte-nova"), undefined);
}

console.log("\nformato novo");
write({ SAIN: { ids: { "sp-mod": "791", "fonte-nova": "42" } } });
{
  const c = loadForgeMatchCache(dir);
  check("le o id da fonte pedida", cachedIdFor(c.SAIN, "fonte-nova"), "42");
  check("nao mistura fontes", cachedIdFor(c.SAIN, "sp-mod"), "791");
  check("fonte sem entrada e sem legado devolve undefined", cachedIdFor(c.SAIN, "outra"), undefined);
}

console.log("\nid explicito da fonte ganha do legado");
write({ SAIN: { ids: { "legacy-forge": "791", "sp-mod": "999" } } });
check("nao volta pro legado quando ha id proprio", cachedIdFor(loadForgeMatchCache(dir).SAIN, "sp-mod"), "999");

console.log("\nescrita preserva outras fontes");
write({ SAIN: { ids: { "forge-alt": "791" } } });
{
  const c = loadForgeMatchCache(dir);
  c.SAIN = { ids: { ...c.SAIN.ids, "sp-mod": "791" } };
  saveForgeMatchCache(dir, c);
  const relido = loadForgeMatchCache(dir);
  check("as duas fontes convivem", relido.SAIN.ids, { "forge-alt": "791", "sp-mod": "791" });
}

console.log("\nentradas invalidas");
write({ SAIN: null, Wedge: 42, Bom: { ids: { "sp-mod": "1" } } });
check("descarta lixo e mantem o valido", Object.keys(loadForgeMatchCache(dir)), ["Bom"]);

fs.writeFileSync(path.join(dir, FILE), "{ nao e json", "utf-8");
check("arquivo corrompido devolve vazio, nao estoura", loadForgeMatchCache(dir), {});

console.log("\nanotacao de busca infrutifera");
{
  const agora = new Date().toISOString();
  const antigo = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
  write({
    Novo: { ids: {}, misses: { "sp-mod": agora } },
    Velho: { ids: {}, misses: { "sp-mod": antigo } },
    OutraFonte: { ids: {}, misses: { "forge-alt": agora } },
    Corrompido: { ids: {}, misses: { "sp-mod": "nao e data" } }
  });
  const c = loadForgeMatchCache(dir);
  check("miss sobrevive ao load", c.Novo.misses?.["sp-mod"], agora);
  check("miss de outra fonte nao vaza", c.OutraFonte.misses?.["sp-mod"], undefined);
  check("ids continua presente", c.Novo.ids, {});
  check("data corrompida nao vira miss valido", Number.isFinite(Date.parse(c.Corrompido.misses!["sp-mod"])), false);
}

console.log("\nmiss e id convivem");
{
  write({ Misto: { ids: { "sp-mod": "791" }, misses: { "forge-alt": new Date().toISOString() } } });
  const c = loadForgeMatchCache(dir);
  check("id da fonte que achou", cachedIdFor(c.Misto, "sp-mod"), "791");
  check("miss registrado na outra", !!c.Misto.misses?.["forge-alt"], true);
  saveForgeMatchCache(dir, c);
  const relido = loadForgeMatchCache(dir);
  check("sobrevive ao salvar e reler", relido.Misto.misses?.["forge-alt"], c.Misto.misses?.["forge-alt"]);
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);