import * as http from "http";

let ok = 0, fail = 0;
function check(label: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? "\n         " + extra : ""}`); }
}

/** Cópia da regra do lerJson, pra testar sem subir o Electron. */
async function lerJson(res: Response, ondeVeio: string): Promise<any> {
  const texto = await res.text();
  try { return JSON.parse(texto); }
  catch {
    const tipo = res.headers.get("content-type") || "sem content-type";
    const inicio = texto.trim().slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`${ondeVeio} respondeu ${res.status} ${res.statusText} em vez de JSON (${tipo}). Começo da resposta: ${inicio || "(vazia)"}`);
  }
}

const servidor = http.createServer((req, res) => {
  if (req.url === "/json") { res.setHeader("content-type", "application/json"); return res.end('{"success":true,"data":[]}'); }
  if (req.url === "/cloudflare") { res.statusCode = 502; res.setHeader("content-type", "text/html"); return res.end("<!DOCTYPE html>\n<html><head><title>502 Bad Gateway</title></head><body>error</body></html>"); }
  if (req.url === "/portal") { res.statusCode = 200; res.setHeader("content-type", "text/html"); return res.end("<html><body>Faça login na rede Wi-Fi</body></html>"); }
  if (req.url === "/vazio") { res.statusCode = 503; return res.end(""); }
  res.statusCode = 404; res.end("nope");
});

async function main() {
  await new Promise<void>((r) => servidor.listen(8821, r));
  const base = "http://127.0.0.1:8821";

  console.log("\nleitura de resposta");
  const bom = await lerJson(await fetch(`${base}/json`), "sp-mod.com");
  check("JSON válido continua sendo lido", bom?.success === true);

  for (const [rota, esperado] of [["/cloudflare", "502"], ["/portal", "200"], ["/vazio", "503"]] as const) {
    try {
      await lerJson(await fetch(base + rota), "sp-mod.com");
      check(`${rota} deveria falhar`, false);
    } catch (e: any) {
      const m = e.message as string;
      check(`${rota}: erro cita o status ${esperado}`, m.includes(esperado), m);
      check(`${rota}: erro NÃO fala em "Unexpected token"`, !m.includes("Unexpected token"), m);
      check(`${rota}: erro nomeia a fonte`, m.includes("sp-mod.com"), m);
    }
  }

  const vazio = await fetch(`${base}/vazio`);
  try { await lerJson(vazio, "sp-mod.com"); } catch (e: any) {
    check("corpo vazio é descrito como vazio", e.message.includes("(vazia)"), e.message);
  }

  // Espera o servidor fechar de verdade antes de sair. Sair com o handle ainda
  // fechando fazia o Node abortar no Windows com "Assertion failed:
  // !(handle->flags & UV_HANDLE_CLOSING)".
  await new Promise<void>((r) => servidor.close(() => r()));
  console.log(`\n${ok} ok, ${fail} falhas\n`);
  process.exitCode = fail ? 1 : 0;
}
main();