/** "Limpar preferências da interface" da tela de erro (src/ErrorBoundary.tsx). */
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

// localStorage de mentira com o mesmo jeito do real: as chaves são as próprias
// propriedades (Object.keys enxerga elas) e os métodos ficam no protótipo.
class ArmazenamentoFalso {
  getItem(k: string) {
    return Object.prototype.hasOwnProperty.call(this, k) ? (this as Record<string, string>)[k] : null;
  }
  setItem(k: string, v: string) {
    (this as Record<string, string>)[k] = String(v);
  }
  removeItem(k: string) {
    delete (this as Record<string, string>)[k];
  }
}
const armazenamento = new ArmazenamentoFalso();
(globalThis as { localStorage: unknown }).localStorage = armazenamento;

(async () => {
  const { limparPreferenciasDaInterface } = await import("../src/ErrorBoundary");
  for (const [k, v] of [
    ["spt-mod-manager.lang", "pt-BR"],
    ["spt-mod-manager.welcomed", "1"],
    ["spt-mod-manager.theme", "olive"],
    ["spt-mod-manager.groupMode", "custom"],
    ["spt-mod-manager.expandedPackages", "{quebrado"],
    ["outra-coisa", "fica"]
  ]) {
    armazenamento.setItem(k, v);
  }

  console.log("\nlimpar preferências da interface");
  check("apagou as 3 do app", limparPreferenciasDaInterface(), 3);
  check("idioma fica", armazenamento.getItem("spt-mod-manager.lang"), "pt-BR");
  check("boas-vindas fica (não mostra de novo)", armazenamento.getItem("spt-mod-manager.welcomed"), "1");
  check("preferência quebrada sai", armazenamento.getItem("spt-mod-manager.expandedPackages"), null);
  check("chave que não é do app fica", armazenamento.getItem("outra-coisa"), "fica");
  check("rodar de novo não apaga mais nada", limparPreferenciasDaInterface(), 0);

  console.log(`\n${ok} ok, ${fail} falhas\n`);
  process.exit(fail ? 1 : 0);
})();
