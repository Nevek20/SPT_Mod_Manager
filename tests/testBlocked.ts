/**
 * Atualização bloqueada: quem trava (blocking_mods) e o link pra forçar.
 * As respostas abaixo são do sp-mod de verdade (nov/2026), recortadas.
 */
import { paraBloqueadores, resolveVersionDownloadLink } from "../electron/modManager";

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

// /mods/updates?mods=com.wtt.commonlib:3.0.1,com.acidphantasm.scorpion:1.0.0&spt_version=4.1.6
const bloqueado = {
  current_version: { id: 14345, mod_id: 2310, guid: "com.wtt.commonlib", name: "WTT - CommonLib", version: "3.0.1" },
  latest_version: { id: 14931, version: "3.0.6", spt_versions: ["4.1.6", "4.1.5", "4.1.4", "4.1.3"] },
  block_reason: "dependency_constraint_violation",
  blocking_mods: [
    {
      mod_id: 1348,
      mod_guid: "com.acidphantasm.scorpion",
      mod_name: "Scorpion",
      current_version: "1.0.0",
      constraint: "~2.0.15",
      incompatible_with: "3.0.6"
    }
  ]
};

// Na lista, o Scorpion aparece pelo nome da pasta.
const nomeLocal = (guid: string | undefined, nome: string | undefined) =>
  guid === "com.acidphantasm.scorpion" ? "acidphantasm-scorpion" : nome ?? guid ?? "";

console.log("\nquem bloqueia");
check("lê o blocking_mods real", paraBloqueadores(bloqueado.blocking_mods, nomeLocal), [
  { name: "acidphantasm-scorpion", modId: 1348, version: "1.0.0", constraint: "~2.0.15" }
]);
check("sem o campo, sem lista", paraBloqueadores(undefined, nomeLocal), undefined);
check("lista vazia vira nada", paraBloqueadores([], nomeLocal), undefined);
check(
  "entrada torta é descartada, a boa fica",
  paraBloqueadores([null, 42, { constraint: "^1" }, { mod_name: "Outro", mod_id: "x" }], nomeLocal),
  [{ name: "Outro", modId: undefined, version: undefined, constraint: undefined }]
);

console.log("\nlink da versão pra forçar");
(async () => {
  const pedidos: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    pedidos.push(String(url));
    // /mods?filter[id]=2310&include=versions&per_page=1
    const corpo = {
      success: true,
      data: [
        {
          id: 2310,
          guid: "com.wtt.commonlib",
          slug: "wtt-commonlib",
          versions: [
            { id: 14931, version: "3.0.6", link: "https://sp-mod.com/mod/download/2310/wtt-commonlib/3.0.6" },
            { id: 14916, version: "3.0.5", link: "https://sp-mod.com/mod/download/2310/wtt-commonlib/3.0.5" }
          ]
        }
      ]
    };
    return new Response(JSON.stringify(corpo), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    check("acha o link da versão pedida", await resolveVersionDownloadLink(2310, "3.0.6"), "https://sp-mod.com/mod/download/2310/wtt-commonlib/3.0.6");
    check("pede pelo id, com as versões", /filter%5Bid%5D=2310/.test(pedidos[0]) && /include=versions/.test(pedidos[0]), true);
    check("versão que não existe dá null", await resolveVersionDownloadLink(2310, "9.9.9"), null);
    check("id inválido nem pergunta", [await resolveVersionDownloadLink(0, "1.0.0"), pedidos.length], [null, 2]);
  } finally {
    globalThis.fetch = original;
  }
  console.log(`\n${ok} ok, ${fail} falhas\n`);
  process.exit(fail ? 1 : 0);
})();
