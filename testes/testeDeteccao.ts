import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveSptInstance } from "../electron/modManager";

let ok = 0, fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         esperado ${JSON.stringify(want)}\n         obtido   ${JSON.stringify(got)}`); }
}

const B = fs.mkdtempSync(path.join(os.tmpdir(), "det-"));
const mk = (p: string) => fs.mkdirSync(path.join(B, p), { recursive: true });
const tk = (p: string) => fs.writeFileSync(path.join(B, p), "");
const res = (p: string) => {
  const r = resolveSptInstance(path.join(B, p))?.instance;
  if (!r) return null;
  // Normaliza a barra: o resolveSptInstance usa path.join, que devolve "\" no
  // Windows e "/" no Linux. Sem isto o teste passa num sistema e falha no outro
  // por causa do separador, sem que nada de real esteja errado.
  const rel = (abs: string) => abs.slice(B.length).replace(/\\/g, "/") || "/";
  return { client: rel(r.clientRoot), server: rel(r.serverRoot), split: r.split };
};

// Caso Kovacs: executáveis duplicados na raiz, os de verdade em SPT_Runtime
mk("kovacs/BepInEx/plugins"); tk("kovacs/EscapeFromTarkov.exe");
tk("kovacs/SPT.Server.exe"); tk("kovacs/SPT.Launcher.exe");
mk("kovacs/SPT_Runtime/user/mods"); tk("kovacs/SPT_Runtime/SPT.Server.exe"); tk("kovacs/SPT_Runtime/SPT.Launcher.exe");

// 4.1 normal
mk("normal/BepInEx/plugins"); tk("normal/EscapeFromTarkov.exe");
mk("normal/SPT_Runtime/user/mods"); tk("normal/SPT_Runtime/SPT.Server.exe");

// tudo junto na mesma pasta (sem subpasta de servidor)
mk("plano/BepInEx/plugins"); mk("plano/user/mods");
tk("plano/EscapeFromTarkov.exe"); tk("plano/SPT.Server.exe");

// só servidor, sem client em lugar nenhum
mk("soserver/user/mods"); tk("soserver/SPT.Server.exe");

// legado Aki
mk("aki/BepInEx"); mk("aki/user/mods"); tk("aki/Aki.Server.exe"); tk("aki/EscapeFromTarkov.exe");

console.log("\ndeteccao de instancia");
check("Kovacs: exe solto na raiz NAO ganha da subpasta", res("kovacs"), { client: "/kovacs", server: "/kovacs/SPT_Runtime", split: true });
check("Kovacs: escolher SPT_Runtime direto tambem acerta", res("kovacs/SPT_Runtime"), { client: "/kovacs", server: "/kovacs/SPT_Runtime", split: true });
check("4.1 normal", res("normal"), { client: "/normal", server: "/normal/SPT_Runtime", split: true });
check("4.1 normal pela subpasta", res("normal/SPT_Runtime"), { client: "/normal", server: "/normal/SPT_Runtime", split: true });
check("instalacao plana continua nao dividida", res("plano"), { client: "/plano", server: "/plano", split: false });
check("so servidor", res("soserver"), { client: "/soserver", server: "/soserver", split: false });
check("legado Aki", res("aki"), { client: "/aki", server: "/aki", split: false });
check("pasta sem nada", res("naoexiste"), null);

console.log(`\n${ok} ok, ${fail} falhas\n`);
fs.rmSync(B, { recursive: true, force: true });
process.exit(fail ? 1 : 0);