import { checkSptCompatibility } from "./electron/modManager";
let ok=0,fail=0;
const check=(l:string,g:unknown,w:unknown)=>{ if(JSON.stringify(g)===JSON.stringify(w)){ok++;console.log("  ok   "+l);} else {fail++;console.log(`  FAIL ${l}\n    esperado ${JSON.stringify(w)}\n    obtido   ${JSON.stringify(g)}`);} };

console.log("\ncompatibilidade com a instancia em 4.1.2 (dados reais do sp-mod)");
check("BigBrain 1.5.0 (~4.1.0) serve", checkSptCompatibility("~4.1.0", "4.1.2"), "compatible");
check("SAIN 4.4.3 (~4.0.0) nao serve", checkSptCompatibility("~4.0.0", "4.1.2"), "incompatible");
check("Looting Bots 1.7.0 (~4.0 <4.1.0) nao serve", checkSptCompatibility("~4.0 <4.1.0", "4.1.2"), "incompatible");
check("Scav Cat (4.0.10 exato, com espacos) nao serve", checkSptCompatibility(" 4.0.10 ", "4.1.2"), "incompatible");
check("versao fixa 4.1.0 nao serve em 4.1.2", checkSptCompatibility("4.1.0", "4.1.2"), "incompatible");
check("constraint vazia fica desconhecida", checkSptCompatibility("", "4.1.2"), "unknown");
check("sem versao da instancia fica desconhecida", checkSptCompatibility("~4.1.0", ""), "unknown");

console.log("\n(o pedido do Kirill: 4.1.0 e 4.1.1 na instancia 4.1.2)");
check("mod marcado ~4.1.0 ja aparecia como compativel", checkSptCompatibility("~4.1.0", "4.1.2"), "compatible");
check("so o fixado numa versao exata e que fica de fora", checkSptCompatibility("4.1.1", "4.1.2"), "incompatible");

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail?1:0);
