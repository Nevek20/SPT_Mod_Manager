/**
 * Remoção de pacote: tirar uma parte tem que tirar todas.
 *
 * O bug que originou isto: desabilitar um pacote de duas partes movia as duas,
 * mas REMOVER apagava só a que estava selecionada. A linha-pai sumia da lista e
 * a metade órfã reaparecia sozinha na varredura seguinte. Duas ações que o
 * usuário lê como equivalentes se comportavam diferente.
 *
 * Os testes mexem em disco de verdade, numa pasta temporária, porque o valor
 * aqui está justamente em conferir o que sobra depois.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { uninstallMod } from "../electron/modManager";
import type { ModInfo } from "../electron/types";

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

/** Monta uma instância falsa com as duas metades de um pacote instaladas. */
function montaInstancia(): { raiz: string; server: string } {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-pkg-"));
  fs.mkdirSync(path.join(raiz, "user", "mods", "WTT-ServerCommonLib"), { recursive: true });
  fs.mkdirSync(path.join(raiz, "BepInEx", "plugins", "WTT-ClientCommonLib"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "user", "mods", "WTT-ServerCommonLib", "package.json"), "{}");
  fs.writeFileSync(path.join(raiz, "BepInEx", "plugins", "WTT-ClientCommonLib", "lib.dll"), "MZ");
  fs.writeFileSync(
    path.join(raiz, ".spt-mod-manager-registry.json"),
    JSON.stringify([
      { id: "WTT-ServerCommonLib", type: "server", packageId: "src:sp-mod:2310", displayName: "WTT - CommonLib" },
      { id: "WTT-ClientCommonLib", type: "client", packageId: "src:sp-mod:2310", displayName: "WTT - CommonLib" }
    ])
  );
  return { raiz, server: raiz };
}

const base: ModInfo = {
  id: "WTT-ClientCommonLib",
  name: "WTT - CommonLib",
  originalName: "WTT-ClientCommonLib",
  type: "client",
  enabled: true,
  installedManually: false,
  loadOrder: 0
};

const existe = (raiz: string) => ({
  server: fs.existsSync(path.join(raiz, "user", "mods", "WTT-ServerCommonLib")),
  client: fs.existsSync(path.join(raiz, "BepInEx", "plugins", "WTT-ClientCommonLib"))
});

// ---------------------------------------------------------------------------
console.log("\ncascata pelo packageSiblings (o que o scan entrega)");
// ---------------------------------------------------------------------------
{
  const { raiz, server } = montaInstancia();
  const r = uninstallMod(raiz, server, {
    ...base,
    packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }]
  });
  check("remove as DUAS metades", existe(raiz), { server: false, client: false });
  check("e diz quantas partes saíram", r.message, "Mod removido (2 partes do pacote).");
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\ncascata pelo registro (sem packageSiblings no ModInfo)");
// ---------------------------------------------------------------------------
{
  const { raiz, server } = montaInstancia();
  uninstallMod(raiz, server, base);
  check("acha a irmã pelo packageId gravado", existe(raiz), { server: false, client: false });
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\na parte irmã pode estar DESABILITADA");
// ---------------------------------------------------------------------------
{
  const { raiz, server } = montaInstancia();
  // Move a metade de server pra pasta de desabilitados.
  fs.mkdirSync(path.join(raiz, "user", "mods.disabled"), { recursive: true });
  fs.renameSync(
    path.join(raiz, "user", "mods", "WTT-ServerCommonLib"),
    path.join(raiz, "user", "mods.disabled", "WTT-ServerCommonLib")
  );
  uninstallMod(raiz, server, { ...base, packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }] });
  check(
    "acha a irmã na pasta de desabilitados e remove",
    fs.existsSync(path.join(raiz, "user", "mods.disabled", "WTT-ServerCommonLib")),
    false
  );
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nnao pode entrar em recursao infinita");
// ---------------------------------------------------------------------------
{
  const { raiz, server } = montaInstancia();
  // Cada metade aponta pra outra: sem o corte, uma chamaria a outra pra sempre.
  const r = uninstallMod(raiz, server, {
    ...base,
    packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }, { id: "WTT-ClientCommonLib", type: "client" }]
  });
  check("termina e reporta 2 partes, nao 3", r.message, "Mod removido (2 partes do pacote).");
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nmod solo nao muda de comportamento");
// ---------------------------------------------------------------------------
{
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-solo-"));
  fs.mkdirSync(path.join(raiz, "user", "mods", "SoloMod"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "user", "mods", "SoloMod", "package.json"), "{}");
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-registry.json"), "[]");
  const r = uninstallMod(raiz, raiz, {
    ...base,
    id: "SoloMod",
    originalName: "SoloMod",
    name: "SoloMod",
    type: "server"
  });
  check("remove e usa a mensagem simples", r.message, "Mod removido.");
  check("pasta some", fs.existsSync(path.join(raiz, "user", "mods", "SoloMod")), false);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nirma ja ausente do disco nao quebra");
// ---------------------------------------------------------------------------
{
  const { raiz, server } = montaInstancia();
  fs.rmSync(path.join(raiz, "user", "mods", "WTT-ServerCommonLib"), { recursive: true, force: true });
  const r = uninstallMod(raiz, server, {
    ...base,
    packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }]
  });
  check("segue sem erro", r.success, true);
  check("e nao conta como parte removida", r.message, "Mod removido.");
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\ncache de casamento com a fonte sai junto");
// ---------------------------------------------------------------------------
// Relato da comunidade: mod removido continuava aparecendo como instalado no
// catalogo, com o botao dizendo "Reinstalar". A solucao que acharam era apagar
// a linha do .spt-mod-manager-forge-match.json na mao.
{
  const { raiz, server } = montaInstancia();
  const arquivoCache = path.join(raiz, ".spt-mod-manager-forge-match.json");
  fs.writeFileSync(
    arquivoCache,
    JSON.stringify({
      "WTT-ClientCommonLib": { ids: { "sp-mod": "2310" } },
      "WTT-ServerCommonLib": { ids: { "sp-mod": "2310" } },
      OutroMod: { ids: { "sp-mod": "999" } }
    })
  );
  uninstallMod(raiz, server, { ...base, packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }] });
  const restante = JSON.parse(fs.readFileSync(arquivoCache, "utf-8"));
  check("as duas partes saem do cache", Object.keys(restante).sort(), ["OutroMod"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  // Sem arquivo de cache nenhum, a remocao nao pode quebrar.
  const { raiz, server } = montaInstancia();
  const r = uninstallMod(raiz, server, { ...base, packageSiblings: [{ id: "WTT-ServerCommonLib", type: "server" }] });
  check("sem cache no disco, segue normal", r.success, true);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
