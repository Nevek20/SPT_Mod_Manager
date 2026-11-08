/** Comando que inicia o servidor/launcher no Windows (ver electron/launch.ts). */
import { comandoIniciar } from "../electron/launch";

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

const exe = "C:\\games\\SPT\\SPT_Runtime\\SPT.Server.exe";
const c = comandoIniciar(exe, "win32", "C:\\Windows\\system32\\cmd.exe");
check("usa o cmd do sistema", c.file, "C:\\Windows\\system32\\cmd.exe");
// Não pode ser spawn direto do exe: com detached o Windows cria o servidor sem console.
check("passa pelo start, com pasta de trabalho do exe", c.args, [
  "/d",
  "/s",
  "/c",
  '"start "" /D "C:\\games\\SPT\\SPT_Runtime" "C:\\games\\SPT\\SPT_Runtime\\SPT.Server.exe""'
]);
check("argumentos sem reescape do Node", c.verbatim, true);
// String vazia, não undefined: undefined faz o parâmetro voltar ao padrão
// (process.env.ComSpec), e no Windows ele existe, então o teste testaria a
// máquina e não a função.
check("sem ComSpec cai no cmd.exe", comandoIniciar(exe, "win32", "").file, "cmd.exe");
check(
  "pasta com espaço e & continua entre aspas",
  comandoIniciar("C:\\Jogos & Coisas\\SPT\\SPT.Server.exe", "win32", "cmd.exe").args[3],
  '"start "" /D "C:\\Jogos & Coisas\\SPT" "C:\\Jogos & Coisas\\SPT\\SPT.Server.exe""'
);
let recusou = false;
try {
  comandoIniciar('C:\\x" & calc & "\\SPT.Server.exe', "win32", "cmd.exe");
} catch {
  recusou = true;
}
check("recusa aspas no caminho", recusou, true);
check("fora do Windows chama direto", comandoIniciar("/opt/spt/SPT.Server", "linux"), { file: "/opt/spt/SPT.Server", args: [], verbatim: false });

console.log(`\n${ok} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);
