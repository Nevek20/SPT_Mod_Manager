/**
 * Faixas de versão (electron/semver.ts), no formato que o servidor do SPT 4
 * usa pra decidir se carrega os mods. As faixas abaixo são reais do sp-mod.
 */
import { satisfaz, quaseSatisfaz } from "../electron/semver";
import { checkSptCompatibility } from "../electron/modManager";

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

console.log("\nfaixas reais do catálogo, SPT 4.1.6");
check("~4.1.0 aceita", satisfaz("~4.1.0", "4.1.6"), true);
check("UnityToolkit 2.0.2: '4.1.5' exato não aceita", satisfaz("4.1.5", "4.1.6"), false);
check("UnityToolkit 2.0.1: '>=4.0.0 <4.1.0' NÃO aceita (o bug da 0.8.0)", satisfaz(">=4.0.0 <4.1.0", "4.1.6"), false);
check("~3.7.0 (Amands' Sense antigo) não aceita", satisfaz("~3.7.0", "4.1.6"), false);
check("~4.0.0 não aceita", satisfaz("~4.0.0", "4.1.6"), false);
check("~4.0 <4.1.0 não aceita", satisfaz("~4.0 <4.1.0", "4.1.6"), false);
check("^4.0.0 aceita", satisfaz("^4.0.0", "4.1.6"), true);

console.log("\noperadores");
check(">= com espaço", satisfaz(">= 4.1.0", "4.1.6"), true);
check("< exclui o próprio", satisfaz("<4.1.6", "4.1.6"), false);
check("<= inclui o próprio", satisfaz("<=4.1.6", "4.1.6"), true);
check(">4.1 é >=4.2.0", satisfaz(">4.1", "4.1.9"), false);
check("<=4.1 é <4.2.0", satisfaz("<=4.1", "4.1.9"), true);
check("4.1.x", satisfaz("4.1.x", "4.1.6"), true);
check("4.x", satisfaz("4.x", "4.1.6"), true);
check("4.1 parcial", satisfaz("4.1", "4.1.6"), true);
check("*", satisfaz("*", "4.1.6"), true);
check("hífen inclusivo", satisfaz("4.1.0 - 4.1.6", "4.1.6"), true);
check("hífen fora", satisfaz("4.0.0 - 4.1.5", "4.1.6"), false);
check("OU", satisfaz("~4.0.0 || ~4.1.0", "4.1.6"), true);
check("OU sem nenhum", satisfaz("~3.10.0 || ~4.0.0", "4.1.6"), false);
check("^0.x trava o minor", satisfaz("^0.3.0", "0.4.0"), false);
check("~> do Ruby/C#", satisfaz("~>4.1.0", "4.1.6"), true);
check("v na frente", satisfaz("v4.1.6", "4.1.6"), true);
check("pré-lançamento na instância", satisfaz("~4.1.0", "4.1.6-beta"), true);

console.log("\nnão sei é não sei");
check("faixa vazia", satisfaz("", "4.1.6"), null);
check("faixa ilegível", satisfaz("qualquer coisa", "4.1.6"), null);
check("versão ilegível", satisfaz("~4.1.0", "abc"), null);
check("alternativa ilegível não estraga a boa", satisfaz("lixo || ~4.1.0", "4.1.6"), true);

console.log("\nquase (mesmo 4.1, outro último número)");
check("4.1.5 exato no 4.1.6", quaseSatisfaz("4.1.5", "4.1.6"), true);
check("<4.1.6 no 4.1.6", quaseSatisfaz("<4.1.6", "4.1.6"), true);
check("~4.0.0 no 4.1.6 não é quase", quaseSatisfaz("~4.0.0", "4.1.6"), false);
check(">=4.0.0 <4.1.0 não é quase", quaseSatisfaz(">=4.0.0 <4.1.0", "4.1.6"), false);
check("o que já serve não é quase", quaseSatisfaz("~4.1.0", "4.1.6"), false);

console.log("\ncheckSptCompatibility usa a regra nova");
check("bug da 0.8.0 corrigido", checkSptCompatibility(">=4.0.0 <4.1.0", "4.1.6"), "incompatible");
check("vazio continua desconhecido", checkSptCompatibility("", "4.1.6"), "unknown");

console.log(`\n${ok} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);
