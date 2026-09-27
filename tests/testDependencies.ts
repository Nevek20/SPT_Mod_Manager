/**
 * Resolução de dependências: o que a fonte devolve, cruzado com o instalado.
 *
 * O JSON base é a resposta REAL do sp-mod para
 * /mods/dependencies?mods=2512:2.0.1&spt_version=4.1.2 — o WTT-ContentBackport
 * pedindo o WTT-CommonLib.
 *
 * O que estes testes protegem é o `status`, porque é ele que decide se o
 * usuário vê um aviso ou não. Errar pro lado do alarme falso já custou caro
 * neste projeto: um GUID lido fora de contexto virava "dependência faltando".
 */

import { resolveModDependencies } from "../electron/modManager";

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

const CHAVE = "2512:2.0.1";
const resposta = (deps: any[]) => ({ success: true, data: { [CHAVE]: deps } });

const COMMONLIB = {
  id: 2310,
  guid: "com.wtt.commonlib",
  name: "WTT - CommonLib",
  slug: "wtt-commonlib",
  latest_compatible_version: {
    id: 14737,
    version: "3.0.4",
    link: "https://sp-mod.com/mod/download/2310/wtt-commonlib/3.0.4",
    content_length: 247518,
    fika_compatibility: "compatible"
  },
  conflict: false,
  dependencies: []
};

const r = (deps: any[], instalados: { guid?: string; name: string; version?: string }[]) =>
  resolveModDependencies(resposta(deps), CHAVE, instalados);

// ---------------------------------------------------------------------------
console.log("\nstatus contra o que esta instalado");
// ---------------------------------------------------------------------------
check("nao instalado e com link -> missing", r([COMMONLIB], [])[0].status, "missing");

check(
  "instalado na mesma versao -> installed",
  r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib", version: "3.0.4" }])[0].status,
  "installed"
);

check(
  "instalado em versao MAIS VELHA -> outdated (o caso real 3.0.2 vs 3.0.4)",
  r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib", version: "3.0.2" }])[0].status,
  "outdated"
);

check(
  "instalado em versao mais nova nao vira outdated",
  r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib", version: "3.1.0" }])[0].status,
  "installed"
);

// O heap #US do .NET deduplica literais, entao seis mods reais ficam sem versao
// lida. Sem versao nao da pra AFIRMAR que esta velho — e mandar atualizar quem
// ja esta atualizado e o mesmo alarme falso de sempre.
check(
  "instalado SEM versao lida nao vira outdated",
  r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib" }])[0].status,
  "installed"
);

// Comparacao numerica, nao alfabetica: "3.0.10" > "3.0.9".
const dezVsNove = { ...COMMONLIB, latest_compatible_version: { ...COMMONLIB.latest_compatible_version, version: "3.0.10" } };
check(
  "3.0.9 instalado contra 3.0.10 disponivel -> outdated",
  r([dezVsNove], [{ guid: "com.wtt.commonlib", name: "lib", version: "3.0.9" }])[0].status,
  "outdated"
);

// Sem link nao adianta avisar: nao ha o que oferecer.
const semLink = { ...COMMONLIB, latest_compatible_version: { id: 1, version: "3.0.4" } };
check("faltando mas sem link -> unavailable", r([semLink], [])[0].status, "unavailable");
check(
  "velho mas sem link -> installed (nao ha atualizacao a oferecer)",
  r([semLink], [{ guid: "com.wtt.commonlib", name: "lib", version: "3.0.2" }])[0].status,
  "installed"
);

// GUID e case-insensitive: o DLL nem sempre grava minusculo (com.IcyClawz.*).
check(
  "casamento de GUID ignora maiuscula",
  r([COMMONLIB], [{ guid: "COM.WTT.CommonLib", name: "lib", version: "3.0.4" }])[0].status,
  "installed"
);

// ---------------------------------------------------------------------------
console.log("\ncampos que vao pra tela");
// ---------------------------------------------------------------------------
const um = r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib", version: "3.0.2" }])[0];
check("usa o nome publicado, nao o GUID", um.name, "WTT - CommonLib");
check("traz o link de download", um.downloadLink, "https://sp-mod.com/mod/download/2310/wtt-commonlib/3.0.4");
check("traz o tamanho", um.sizeBytes, 247518);
check("traz a versao instalada, pra mensagem dizer 'de X para Y'", [um.installedVersion, um.version], ["3.0.2", "3.0.4"]);
check("traz o nome da pasta instalada", um.installedName, "WTT-ServerCommonLib");
check("dependencia direta tem depth 0", um.depth, 0);

const semNome = r([{ ...COMMONLIB, name: undefined }], [])[0];
check("sem nome publicado, cai no GUID em vez de mostrar vazio", semNome.name, "com.wtt.commonlib");

// ---------------------------------------------------------------------------
console.log("\narvore aninhada");
// ---------------------------------------------------------------------------
const aninhado = [
  {
    ...COMMONLIB,
    dependencies: [
      {
        id: 99,
        guid: "com.outra.lib",
        name: "Outra Lib",
        conflict: false,
        latest_compatible_version: { version: "1.0.0", link: "https://exemplo/1.0.0", content_length: 100 },
        dependencies: []
      }
    ]
  }
];
const arv = r(aninhado, []);
check("achata a arvore inteira", arv.length, 2);
check("preserva a profundidade", [arv[0].depth, arv[1].depth], [0, 1]);
check("a dependencia da dependencia tambem e resolvida", arv[1].status, "missing");

// Mesmo GUID em dois ramos nao pode aparecer duas vezes na tela.
const duplicado = [COMMONLIB, { ...COMMONLIB, dependencies: [COMMONLIB] }];
check("GUID repetido aparece uma vez so", r(duplicado, []).length, 1);

// ---------------------------------------------------------------------------
console.log("\nconflito e entradas ruins");
// ---------------------------------------------------------------------------
check("conflict do JSON vira o campo conflict", r([{ ...COMMONLIB, conflict: true }], [])[0].conflict, true);
check("conflict ausente e false, nao undefined", r([{ ...COMMONLIB, conflict: undefined }], [])[0].conflict, false);

// Falha de rede, chave errada ou resposta estranha: lista vazia, sem estourar.
// O usuario veio instalar um mod; a checagem e auxilio, nao pedagio.
check("json nulo devolve vazio", resolveModDependencies(null, CHAVE, []), []);
check("chave ausente devolve vazio", resolveModDependencies(resposta([]), "outra:1.0", []), []);
check("data nao-array devolve vazio", resolveModDependencies({ data: { [CHAVE]: "oi" } }, CHAVE, []), []);
check("entrada sem guid e ignorada", r([{ id: 1, name: "Sem GUID" }], []).length, 0);
check("mod sem dependencia nenhuma devolve vazio", r([], []), []);

// ---------------------------------------------------------------------------
console.log("\nusedBy — quem mais depende da mesma lib");
// ---------------------------------------------------------------------------
// Caso real: Scorpion fixa CommonLib 3.0.3, ContentBackport fixa 3.0.4. Só uma
// fica no disco, entao atualizar por causa de um pode tirar o outro da versao
// que o autor dele testou.
const comScorpion = r([COMMONLIB], [
  { guid: "com.wtt.commonlib", name: "WTT-ServerCommonLib", version: "3.0.3" },
  { guid: "com.acidphantasm.scorpion", name: "acidphantasm-scorpion", version: "1.1.1", requiresGuids: ["com.wtt.commonlib"] }
])[0];
check("lista quem ja instalado exige a lib", comScorpion.usedBy, ["acidphantasm-scorpion"]);
check("e o status continua outdated", comScorpion.status, "outdated");

const doisUsam = r([COMMONLIB], [
  { guid: "com.wtt.commonlib", name: "lib", version: "3.0.3" },
  { guid: "a", name: "Scorpion", requiresGuids: ["com.wtt.commonlib"] },
  { guid: "b", name: "Eco-WW2-Pack", requiresGuids: ["COM.WTT.CommonLib"] }
])[0];
check("junta varios e ignora maiuscula no GUID exigido", doisUsam.usedBy, ["Scorpion", "Eco-WW2-Pack"]);

check(
  "ninguem usando deixa usedBy indefinido",
  r([COMMONLIB], [{ guid: "com.wtt.commonlib", name: "lib", version: "3.0.3" }])[0].usedBy,
  undefined
);

check(
  "mod que exige outra coisa nao entra na lista",
  r([COMMONLIB], [
    { guid: "com.wtt.commonlib", name: "lib", version: "3.0.3" },
    { guid: "x", name: "Outro", requiresGuids: ["com.outra.lib"] }
  ])[0].usedBy,
  undefined
);

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);