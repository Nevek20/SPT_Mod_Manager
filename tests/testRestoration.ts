/**
 * Escolha de versão ao restaurar uma lista de mods importada.
 *
 * Bug relatado: importar uma lista baixava a versão MAIS RECENTE em vez da que
 * estava no arquivo. A versão sempre esteve gravada no export; o caminho de
 * restauração é que nunca a lia. Quem exportava com o SAIN 4.4.3 e restaurava
 * recebia 4.5.0, o que pode quebrar a combinação inteira que a pessoa tinha.
 */

import { escolheVersaoParaRestaurar } from "../electron/modManager";

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

const SAIN = {
  latestVersion: "4.5.0",
  latestVersionLink: "https://exemplo/4.5.0",
  versions: [
    { version: "4.5.0", link: "https://exemplo/4.5.0" },
    { version: "4.4.3", link: "https://exemplo/4.4.3" },
    { version: "4.4.0", link: "https://exemplo/4.4.0" }
  ]
};

console.log("\na versao da lista ganha da mais recente");
check("pede 4.4.3, recebe 4.4.3", escolheVersaoParaRestaurar(SAIN, "4.4.3"), { version: "4.4.3", link: "https://exemplo/4.4.3" });
check("pede a mais antiga, recebe a mais antiga", escolheVersaoParaRestaurar(SAIN, "4.4.0")?.version, "4.4.0");
check("pede a mais recente, recebe ela mesma", escolheVersaoParaRestaurar(SAIN, "4.5.0")?.version, "4.5.0");

console.log("\nsem versao pedida, cai na mais recente");
check("lista antiga, sem versao gravada", escolheVersaoParaRestaurar(SAIN)?.version, "4.5.0");
check("versao vazia conta como ausente", escolheVersaoParaRestaurar(SAIN, "")?.version, "4.5.0");

console.log("\nversao pedida que nao existe mais");
check(
  "cai na mais recente em vez de nao instalar nada",
  escolheVersaoParaRestaurar(SAIN, "3.0.0")?.version,
  "4.5.0"
);

console.log("\ncasos degenerados");
// Entrada da versao pedida existe mas nao tem link: nao adianta, cai na recente.
check("versao pedida sem link em NENHUMA entrada: cai na mais recente",
  escolheVersaoParaRestaurar(
    { ...SAIN, versions: [{ version: "4.4.3" }, { version: "4.5.0", link: "https://exemplo/4.5.0" }] },
    "4.4.3"
  )?.version,
  "4.5.0");
// E quando ha duas entradas da mesma versao, uma sem link e outra com, vale a
// que da pra baixar — senao uma entrada capenga da fonte perderia a restauracao.
check("entrada sem link nao atrapalha outra com link da mesma versao",
  escolheVersaoParaRestaurar({ ...SAIN, versions: [{ version: "4.4.3" }, ...SAIN.versions] }, "4.4.3")?.version,
  "4.4.3");
check("sem link da mais recente, usa qualquer uma que tenha",
  escolheVersaoParaRestaurar({ versions: [{ version: "2.0.0", link: "https://exemplo/2.0.0" }] })?.version,
  "2.0.0");
check("sem nada aproveitavel devolve null", escolheVersaoParaRestaurar({ versions: [{ version: "1.0.0" }] }), null);
check("objeto vazio devolve null", escolheVersaoParaRestaurar({}), null);
check("comparacao e exata, nao por prefixo", escolheVersaoParaRestaurar(SAIN, "4.4")?.version, "4.5.0");

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
