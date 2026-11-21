/**
 * Incompatíveis com a versão do SPT: a checagem diz QUAL faixa o mod declara e
 * se ela serve noutro patch do mesmo 4.1 (relato do Дмитрий, 0.8.0).
 *
 * Respostas recortadas do sp-mod de verdade (nov/2026): o UnityToolkit 2.0.2
 * declara "4.1.5" exato, e a fonte o devolve em incompatible_with_spt no 4.1.6.
 */
import { checkForgeUpdates } from "../electron/modManager";

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

const CATALOGO: Record<string, { id: number; name: string; versoes: [string, string][] }> = {
  "com.arys.unitytoolkit": {
    id: 1426,
    name: "UnityToolkit",
    versoes: [
      ["2.0.2", "4.1.5"],
      ["2.0.1", ">=4.0.0 <4.1.0"]
    ]
  },
  "com.velho.mod": { id: 77, name: "VelhoMod", versoes: [["1.0.0", "~4.0.0"]] }
};
const porId = new Map(Object.entries(CATALOGO).map(([guid, m]) => [String(m.id), { guid, ...m }]));
const pedidos: string[] = [];

(globalThis as { fetch: unknown }).fetch = async (entrada: unknown) => {
  const u = new URL(String(entrada));
  pedidos.push(u.pathname + u.search);
  let corpo: unknown;
  if (u.pathname.endsWith("/mods/updates")) {
    const incompativeis = [];
    for (const par of (u.searchParams.get("mods") ?? "").split(",").filter(Boolean)) {
      const corte = par.lastIndexOf(":");
      const guid = par.slice(0, corte);
      const m = CATALOGO[guid];
      if (!m) continue;
      incompativeis.push({ id: 1, mod_id: m.id, guid, name: m.name, version: par.slice(corte + 1), reason: "no_version_for_spt", latest_compatible_version: null });
    }
    corpo = { success: true, data: { spt_version: "4.1.6", updates: [], blocked_updates: [], up_to_date: [], incompatible_with_spt: incompativeis } };
  } else {
    const ids = (u.searchParams.get("filter[id]") ?? "").split(",").filter(Boolean);
    const guids = (u.searchParams.get("filter[guid]") ?? "").split(",").filter(Boolean);
    const lista = ids.length ? ids.map((id) => porId.get(id)).filter(Boolean) : guids.map((g) => (CATALOGO[g] ? { guid: g, ...CATALOGO[g] } : null)).filter(Boolean);
    corpo = {
      success: true,
      data: (lista as { guid: string; id: number; name: string; versoes: [string, string][] }[]).map((m) => ({
        id: m.id,
        guid: m.guid,
        name: m.name,
        owner: { name: "autor" },
        versions: m.versoes.map(([version, faixa]) => ({ version, spt_version_constraint: faixa, link: `https://fonte/${m.id}/${version}` }))
      }))
    };
  }
  return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
};

(async () => {
  const r = await checkForgeUpdates(
    [
      { name: "UnityToolkit", originalName: "UnityToolkit", version: "2.0.2", guid: "com.arys.unitytoolkit" },
      { name: "VelhoMod", originalName: "VelhoMod", version: "1.0.0", guid: "com.velho.mod" }
    ],
    "4.1.6"
  );
  const unity = r.incompatible.find((i) => i.name === "UnityToolkit");
  const velho = r.incompatible.find((i) => i.name === "VelhoMod");

  console.log("\nfaixa declarada");
  check("UnityToolkit traz a faixa da versão INSTALADA", unity?.declaredSpt, "4.1.5");
  check("e é quase: serve no 4.1.5, só não no 4.1.6", unity?.nearMiss, true);
  check("mod do 4.0 traz a faixa", velho?.declaredSpt, "~4.0.0");
  check("e não é quase", velho?.nearMiss, false);

  console.log("\ncusto");
  // A busca por GUID também pede as versões; a das faixas é a por id.
  check("uma consulta só pras faixas dos dois", pedidos.filter((p) => p.includes("filter%5Bid%5D")).length, 1);

  console.log("\nsem rede pra faixa, a lista vem como antes");
  (globalThis as { fetch: unknown }).fetch = async (entrada: unknown) => {
    const u = new URL(String(entrada));
    if (u.searchParams.get("filter[id]")) throw new TypeError("fetch failed");
    return new Response(
      JSON.stringify({
        success: true,
        data: u.pathname.endsWith("/mods/updates")
          ? { updates: [], blocked_updates: [], up_to_date: [], incompatible_with_spt: [{ mod_id: 1426, guid: "com.arys.unitytoolkit", name: "UnityToolkit", version: "2.0.2", reason: "no_version_for_spt" }] }
          : [{ id: 1426, guid: "com.arys.unitytoolkit", name: "UnityToolkit", versions: [] }]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const r2 = await checkForgeUpdates([{ name: "UnityToolkit", originalName: "UnityToolkit", version: "2.0.2", guid: "com.arys.unitytoolkit" }], "4.1.6");
  check("continua listado como incompatível", r2.incompatible.map((i) => i.name), ["UnityToolkit"]);
  check("sem faixa inventada", r2.incompatible[0]?.declaredSpt, undefined);

  console.log(`\n${ok} ok, ${fail} falhas\n`);
  process.exit(fail ? 1 : 0);
})();
