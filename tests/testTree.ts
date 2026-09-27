import { buildModTree, parentName } from "../src/modTree";
import type { ModInfo, ModType } from "../src/types";

let ok = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    ok++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         esperado ${w}\n         obtido   ${g}`);
  }
}

const mod = (id: string, type: ModType, extra: Partial<ModInfo> = {}): ModInfo => ({
  id,
  name: id,
  originalName: id,
  type,
  enabled: true,
  installedManually: false,
  loadOrder: 0,
  ...extra
});

console.log("\nnome do pai");
check(
  "usa o forgeName quando existe",
  parentName([mod("SAIN.4.4.3", "server", { forgeName: "SAIN - Solarint's AI Modifications" }), mod("SAIN.4.4.3", "client")]),
  "SAIN - Solarint's AI Modifications"
);
check(
  "acha o forgeName em qualquer parte, nao so na primeira",
  parentName([mod("Wedge", "server"), mod("Wedge", "client", { forgeName: "Wedge" })]),
  "Wedge"
);
check(
  "sem forgeName, tira o sufixo de papel",
  parentName([mod("MoreBotsServer", "server"), mod("MoreBotsAPI", "client")]),
  "MoreBots"
);
check(
  "sem forgeName, nome identico passa direto",
  parentName([mod("Wedge", "server"), mod("Wedge", "client")]),
  "Wedge"
);
check(
  "MergeConsumablesServer + MergeConsumables",
  parentName([mod("MergeConsumablesServer", "server"), mod("MergeConsumables", "client")]),
  "MergeConsumables"
);
check("mod solo mantem o proprio nome", parentName([mod("Looting Bots", "client")]), "Looting Bots");
check(
  "mod solo ignora o forgeName: um rename do usuario nao pode ser atropelado",
  parentName([mod("Meu Looting Bots", "client", { forgeName: "Looting Bots" })]),
  "Meu Looting Bots"
);
check(
  "SAIN real: sufixo ServerMod escapa da limpeza, entao fica com o mais curto",
  parentName([mod("SAIN", "client"), mod("Solarint-SAIN-ServerMod", "server")]),
  "SAIN"
);
check(
  "e o resultado NAO depende da ordem das partes",
  parentName([mod("Solarint-SAIN-ServerMod", "server"), mod("SAIN", "client")]),
  "SAIN"
);
check(
  "SalcosArmory real: sufixo .Client sai e os nomes convergem",
  parentName([mod("SalcosArmory", "server"), mod("SalcosArmory.Client", "client")]),
  "SalcosArmory"
);
check(
  "empate de tamanho resolve por ordem alfabetica, nunca por ordem de scan",
  parentName([mod("BetaThing", "client"), mod("AlfaThing", "server")]),
  "AlfaThing"
);

console.log("\nagrupamento");
{
  const mods = [
    mod("SAIN.4.4.3", "server", { packageId: "pkg-1", forgeName: "SAIN" }),
    mod("SAIN.4.4.3", "client", { packageId: "pkg-1" }),
    mod("Looting Bots", "client"),
    mod("MoreBotsServer", "server", { packageId: "inferred:morebots" }),
    mod("MoreBotsAPI", "client", { packageId: "inferred:morebots" })
  ];
  const tree = buildModTree(mods, "all");
  check("3 linhas-pai para 5 pastas", tree.length, 3);
  check(
    "nomes e contagem de partes",
    tree.map((n) => [n.name, n.parts.length, n.single]),
    [
      ["SAIN", 2, false],
      ["Looting Bots", 1, true],
      ["MoreBots", 2, false]
    ]
  );
  check("marca o inferido", tree.map((n) => n.inferred), [false, false, true]);
}

console.log("\nmesmo nome de pasta nos dois lados (caso Wedge, sem packageId)");
{
  const mods = [mod("Wedge", "server"), mod("Wedge", "client")];
  const tree = buildModTree(mods, "all");
  check("nao funde mods distintos que so compartilham o nome", tree.length, 2);
}

console.log("\nfiltro de tipo poda os filhos");
{
  const mods = [
    mod("SAIN.4.4.3", "server", { packageId: "pkg-1", forgeName: "SAIN" }),
    mod("SAIN.4.4.3", "client", { packageId: "pkg-1" }),
    mod("Looting Bots", "client"),
    mod("SomeServerOnly", "server")
  ];
  const tree = buildModTree(mods, "client");
  check("mantem o pacote misto e o mod client puro", tree.map((n) => n.name), ["SAIN", "Looting Bots"]);
  check("poda a metade server", tree[0].parts.map((p) => p.type), ["client"]);
  check("registra quantas partes ficaram de fora", tree[0].hiddenParts, 1);
  check("mod client puro nao esconde nada", tree[1].hiddenParts, 0);
  check("nome do pai vem do pacote INTEIRO, nao so da parte que sobrou", tree[0].name, "SAIN");
}



// --- Regressão: a poda por tipo tem que acontecer DEPOIS do agrupamento.
// Se o filtro plano do App.tsx ainda tirasse por tipo antes, o pacote misto
// chegaria aqui já quebrado e o nome do pai sairia da metade sobrevivente.
console.log("\nordem: agrupar antes de podar");
{
  const mods = [
    mod("SAIN.4.4.3", "server", { packageId: "pkg-1", forgeName: "SAIN publicado" }),
    mod("SAIN.4.4.3", "client", { packageId: "pkg-1" })
  ];
  const certo = buildModTree(mods, "client");
  check("nome vem do pacote inteiro", certo[0].name, "SAIN publicado");

  const errado = buildModTree(mods.filter((m) => m.type === "client"), "client");
  check("podar antes perde o forgeName (o que a gente NAO quer)", errado[0].name, "SAIN.4.4.3");
  check("podar antes marca como parte unica (idem)", errado[0].single, true);
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);