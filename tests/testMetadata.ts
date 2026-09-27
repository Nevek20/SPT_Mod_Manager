/**
 * Parser do ModMetadata dos DLLs de server, nos DOIS layouts.
 *
 * Todas as sequências abaixo saíram de DLLs REAIS, pelo levantamento rodado na
 * instalação 4.1.2 — não são inventadas. Elas cobrem o que o levantamento
 * mostrou de variação: ordem de rótulo diferente, campo opcional, dependência
 * com faixa, incompatibilidade sem faixa, e o caso em que o compilador
 * deduplicou a versão e ela some do bloco.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { parseModMetadataFromStrings, readDllModMetadata } from "../electron/modManager";

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

const ROTULOS_PADRAO = [
  "ModGuid = ", ", Name = ", ", Author = ", ", Contributors = ", ", Version = ",
  ", SptVersion = ", ", Incompatibilities = ", ", ModDependencies = ", ", Url = ",
  ", HasPrepatcher = ", ", License = "
];

const p = (strings: string[]) => parseModMetadataFromStrings(strings, []);

// ---------------------------------------------------------------------------
console.log("\nlayout 4.0 (sem rotulos) — nao pode ter regredido");
// ---------------------------------------------------------------------------
check(
  "bosseshavelegamedals, ordem com GUID no inicio",
  p(["ModMetadata", " { ", "com.acidphantasm.bosseshavelegamedals", "Bosses Have Lega Medals", "acidphantasm", "2.1.0", "~4.1.0", "MIT"]),
  { guid: "com.acidphantasm.bosseshavelegamedals", name: "Bosses Have Lega Medals", author: "acidphantasm", version: "2.1.0", sptVersion: "~4.1.0" }
);
check(
  "brightlasers, GUID no FIM (a ordem varia no 4.0)",
  p(["ModMetadata", " { ", "Bright Lasers", "acidphantasm", "1.0.0", "~4.0.0", "MIT", "com.acidphantasm.brightlasers"]),
  { guid: "com.acidphantasm.brightlasers", name: "Bright Lasers", author: "acidphantasm", version: "1.0.0", sptVersion: "~4.0.0" }
);

// ---------------------------------------------------------------------------
console.log("\nlayout 4.1 (com rotulos) — o que estava quebrado na 0.5.3");
// ---------------------------------------------------------------------------
check(
  "bosseshavegpcoins, sem dependencia preenchida",
  p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
     "com.acidphantasm.bosseshavegpcoins", "Bosses Have GP Coins", "acidphantasm", "1.1.0", "~4.1.0", "MIT",
     "user", "mods", "config.json"]),
  { guid: "com.acidphantasm.bosseshavegpcoins", name: "Bosses Have GP Coins", author: "acidphantasm", version: "1.1.0", sptVersion: "~4.1.0" }
);
check(
  "stattrack, sem a abertura ' { ' antes dos rotulos",
  p(["ModMetadata", ...ROTULOS_PADRAO,
     "com.acidphantasm.stattrack", "StatTrack", "acidphantasm", "2.1.1", "~4.1.0", "MIT", "ReplaceIDs"]),
  { guid: "com.acidphantasm.stattrack", name: "StatTrack", author: "acidphantasm", version: "2.1.1", sptVersion: "~4.1.0" }
);
check(
  "botplacementsystem, 14 rotulos com campos opcionais",
  p(["ModMetadata", " { ",
     "ModGuid = ", ", Name = ", ", Author = ", ", Contributors = ", ", Version = ", ", SptVersion = ",
     ", HasPrepatcher = ", ", Incompatibilities = ", ", ModDependencies = ", ", Url = ", ", License = ",
     ", WWWRootUrl = ", ", HomePage = ", ", HomePageDescription = ",
     "com.acidphantasm.botplacementsystem", "Acid's Bot Placement System", "acidphantasm", "2.1.0"]),
  { guid: "com.acidphantasm.botplacementsystem", name: "Acid's Bot Placement System", author: "acidphantasm", version: "2.1.0", sptVersion: undefined }
);

// ---------------------------------------------------------------------------
console.log("\ndependencia (GUID + faixa) vs incompatibilidade (GUID sozinho)");
// ---------------------------------------------------------------------------
check(
  "scorpion depende de com.wtt.commonlib ~3.0",
  p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
     "com.acidphantasm.scorpion", "Scorpion", "acidphantasm", "1.1.1", "~4.1.0",
     "com.wtt.commonlib", "~3.0",
     "https://github.com/sp-tarkov/server-mod-examples", "MIT"]).dependencies,
  [{ guid: "com.wtt.commonlib", constraint: "~3.0" }]
);
check(
  "scorpion NAO tem incompatibilidade",
  p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
     "com.acidphantasm.scorpion", "Scorpion", "acidphantasm", "1.1.1", "~4.1.0",
     "com.wtt.commonlib", "~3.0", "MIT"]).incompatibilities,
  undefined
);

const ozen = p(["ModMetadata", " { ",
  "ModGuid = ", ", Name = ", ", Author = ", ", Contributors = ", ", Version = ", ", SptVersion = ",
  ", HasPrepatcher = ", ", Incompatibilities = ", ", ModDependencies = ", ", Url = ", ", License = ",
  "com.ozen.instantinsurance", "Instant Insurance", "ozen", "Mattdokn", "JustNU", "1.1.0", "~4.1.2",
  "eu.thescrewcollab.equipmentiseternal", "com.gorecreek.fairequipmentrestoration",
  "com.blackhorse311.keepstartinggear", "com.thecrimsonfuckr.configurablesoftcore",
  "https://github.com/ozen-m/SPT-InstantInsurance", "MIT"]);
check(
  "ozen: os quatro GUIDs sem faixa sao INCOMPATIBILIDADE",
  ozen.incompatibilities,
  ["eu.thescrewcollab.equipmentiseternal", "com.gorecreek.fairequipmentrestoration",
   "com.blackhorse311.keepstartinggear", "com.thecrimsonfuckr.configurablesoftcore"]
);
check("ozen: e NAO viram dependencia (era o risco do aviso falso)", ozen.dependencies, undefined);
check("ozen: metadata propria continua certa", [ozen.guid, ozen.name, ozen.version], ["com.ozen.instantinsurance", "Instant Insurance", "1.1.0"]);

check(
  "Eco-WW2-Pack depende de com.wtt.commonlib ~3.0.3 mesmo sem versao propria",
  p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
     "com.wtt.ecoww2pack", "Eco-WW2-Pack", "Eco", "~4.1.2",
     "com.wtt.commonlib", "~3.0.3", "MIT"]).dependencies,
  [{ guid: "com.wtt.commonlib", constraint: "~3.0.3" }]
);

// ---------------------------------------------------------------------------
console.log("\nversao deduplicada pelo heap #US — opcao A: fica sem versao, nao chuta");
// ---------------------------------------------------------------------------
const eco = p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
  "com.wtt.ecoww2pack", "Eco-WW2-Pack", "Eco", "~4.1.2", "com.wtt.commonlib", "~3.0.3", "MIT"]);
check("Eco-WW2-Pack: version indefinida (o literal nao existe no bloco)", eco.version, undefined);
check("Eco-WW2-Pack: mas GUID, nome e autor continuam vindo", [eco.guid, eco.name, eco.author], ["com.wtt.ecoww2pack", "Eco-WW2-Pack", "Eco"]);

const tyfon = p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
  "com.tyfon.hideoutinprogress", "Hideout In Progress", "Tyfon", "~4.1.0",
  "https://github.com/tyfon7/hip", "MIT", "StartUpgrade"]);
check("Tyfon.HideoutInProgress: sem versao, com sptVersion", [tyfon.version, tyfon.sptVersion], [undefined, "~4.1.0"]);

// ---------------------------------------------------------------------------
console.log("\nnao deve inventar nada");
// ---------------------------------------------------------------------------
check("sem o marcador ModMetadata, nao devolve server metadata", p(["Alguma", "coisa", "1.0.0"]).guid, undefined);

// ---------------------------------------------------------------------------
console.log("\ncorte da janela — casos reais que vazavam antes");
// ---------------------------------------------------------------------------
// Sequencia real do Tyfon.HideoutInProgress.Server. O "Tyfon.HideoutInProgress"
// do fim e o NAMESPACE do assembly, atras de mensagens de log — nao e metadata.
// Sem corte, virava "nao convive com a propria metade de client".
const hip = p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
  "com.tyfon.hideoutinprogress", "Hideout In Progress", "Tyfon", "~4.1.0",
  "https://github.com/tyfon7/hip", "MIT", "StartUpgrade", "user/profileData/", ".json",
  "HideoutInProgress: ProfileData serialized to null", "Tyfon.HideoutInProgress",
  "/hip/contribute", "/hip/load"]);
check("HideoutInProgress: o namespace NAO vira incompatibilidade", hip.incompatibilities, undefined);
check("HideoutInProgress: nem dependencia", hip.dependencies, undefined);
check("HideoutInProgress: metadata propria intacta", [hip.guid, hip.name, hip.author, hip.sptVersion],
  ["com.tyfon.hideoutinprogress", "Hideout In Progress", "Tyfon", "~4.1.0"]);

// AssemblyVersion de quatro partes depois da licenca nao pode virar a versao do
// mod — e o valor que a doc do modManager manda ignorar.
const okp = p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
  "ca.bushtail.betterokp", "Better OKP", "bushtail", "~4.1.0", "MIT",
  "2.0.0.0", "VS_VERSION_INFO"]);
check("versao de 4 partes depois da licenca e ignorada", okp.version, undefined);
check("mas o GUID continua vindo", okp.guid, "ca.bushtail.betterokp");

// O corte nao pode comer a dependencia: no Scorpion a url vem DEPOIS do par.
const scorp = p(["ModMetadata", " { ", ...ROTULOS_PADRAO,
  "com.acidphantasm.scorpion", "Scorpion", "acidphantasm", "1.1.1", "~4.1.0",
  "com.wtt.commonlib", "~3.0", "https://github.com/sp-tarkov/server-mod-examples", "MIT",
  "6688d464bc40c867f60e7d7e", "Scorpion has brought his crew into Tarkov"]);
check("corte preserva a dependencia que vem antes da url", scorp.dependencies,
  [{ guid: "com.wtt.commonlib", constraint: "~3.0" }]);
check("corte preserva a versao propria", scorp.version, "1.1.1");

// ---------------------------------------------------------------------------
console.log("\nlado do mod — BepInPlugin so existe no client");
// ---------------------------------------------------------------------------
// Caso real: Tyfon.UIFixes.Server nao tem bloco ModMetadata. Rodar o parser de
// client sobre ele montava um BepInPlugin inexistente a partir de strings
// adjacentes do #Blob — namespace virando "GUID" e AssemblyVersion virando
// versao do mod.
const ascii = ["Tyfon.UIFixes.Server", "UI Fixes", "6.0.1.0"];
check("num DLL de SERVER, o parser de client nao roda", parseModMetadataFromStrings([], ascii, "server"), {});
check(
  "num DLL de CLIENT, continua rodando normal",
  parseModMetadataFromStrings([], ["com.tyfon.uifixes", "UI Fixes", "6.0.1"], "client"),
  { guid: "com.tyfon.uifixes", name: "UI Fixes", version: "6.0.1" }
);
check(
  "em auto (origem desconhecida) tambem roda",
  parseModMetadataFromStrings([], ["com.tyfon.uifixes", "UI Fixes", "6.0.1"]).guid,
  "com.tyfon.uifixes"
);
// O de server continua tendo prioridade quando existe.
check(
  "bloco ModMetadata ganha do BepInPlugin no mesmo DLL",
  parseModMetadataFromStrings(["ModMetadata", " { ", "com.real.mod", "Real", "autor", "1.0.0", "~4.1.0", "MIT"], ascii, "auto").guid,
  "com.real.mod"
);

// ---------------------------------------------------------------------------
console.log("\nBepInDependency (client) — o que segue o GUID decide");
// ---------------------------------------------------------------------------
// Blob de atributo: 01 00 <tam> <texto>. Montado aqui como no formato real.
function ser(txt: string): Buffer {
  return Buffer.concat([Buffer.from([txt.length]), Buffer.from(txt, "latin1")]);
}
function flag(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
const PROLOGO = Buffer.from([0x00, 0x00, 0x01, 0x00]);
function blob(...partes: Buffer[]): Buffer {
  return Buffer.concat([PROLOGO, ...partes, Buffer.from([0x00, 0x00])]);
}
function dll(...blobs: Buffer[]): string {
  const caminho = path.join(os.tmpdir(), `dep-${Math.random().toString(36).slice(2)}.dll`);
  fs.writeFileSync(caminho, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62), ...blobs]));
  return caminho;
}

const comVersao = readDllModMetadata(dll(blob(ser("com.SPT.core"), ser("4.1.0"))), "client");
check("GUID + versao vira dependencia com faixa", comVersao.dependencies, [{ guid: "com.SPT.core", constraint: ">=4.1.0" }]);

const soft = readDllModMetadata(dll(blob(ser("com.fika.core"), flag(2))), "client");
check("flag 2 (Soft) vai pra optionalDependencies", soft.optionalDependencies, ["com.fika.core"]);
check("e NAO vira dependencia obrigatoria", soft.dependencies, undefined);

const hard = readDllModMetadata(dll(blob(ser("com.lacyway.mc"), flag(1))), "client");
check("flag 1 (Hard) vira dependencia sem faixa", hard.dependencies, [{ guid: "com.lacyway.mc", constraint: "*" }]);

// Caso real DrakiaXYZ-BigBrain: o proprio BepInPlugin e guid + NOME, nao versao.
const proprio = readDllModMetadata(dll(blob(ser("xyz.drakia.bigbrain"), ser("DrakiaXYZ-BigBrain"), ser("1.4.0"))), "client");
check("BepInPlugin do proprio mod nao vira dependencia de si mesmo", proprio.dependencies, undefined);

// Caso real BarterItemsStacksClient: nome de tipo seguido de mais nome de tipo.
const ruido = readDllModMetadata(dll(blob(ser("BarterItemsStacksClient.Patches.Compatibility"), ser("AdvancedStashSortingPatch"))), "client");
check("nome de tipo nao vira dependencia", ruido.dependencies, undefined);

// Num DLL de server o atributo nem e procurado.
const noServer = readDllModMetadata(dll(blob(ser("com.SPT.core"), ser("4.1.0"))), "server");
check("em DLL de server, BepInDependency nao e lido", noServer.dependencies, undefined);

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);