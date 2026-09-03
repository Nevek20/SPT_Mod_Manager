/**
 * Marcação de "já instalado" no catálogo.
 *
 * O bug que originou isto: o catálogo dizia "Reinstalar" pra mod que já tinha
 * sido removido. A marcação era montada a partir de duas ANOTAÇÕES do app — o
 * cache de casamento com a fonte e o registro — e nenhuma das duas era
 * conferida contra o disco. Bastava uma delas ficar para trás.
 *
 * Ficavam para trás em três situações, e as três aparecem aqui: remoção antiga
 * feita por uma versão que não limpava, pasta apagada na mão fora do app, e
 * entrada de uma fonte diferente da ativa.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { installedForgeIds } from "../electron/modManager";

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

interface Cenario {
  pastasCliente?: { nome: string; habilitado?: boolean }[];
  pastasServidor?: { nome: string; habilitado?: boolean }[];
  cache?: Record<string, unknown>;
  registro?: unknown[];
}

function monta(c: Cenario): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-inst-"));
  for (const p of c.pastasCliente ?? []) {
    const dir = p.habilitado === false ? ["BepInEx", "plugins.disabled"] : ["BepInEx", "plugins"];
    fs.mkdirSync(path.join(raiz, ...dir, p.nome), { recursive: true });
  }
  for (const p of c.pastasServidor ?? []) {
    const dir = p.habilitado === false ? ["user", "mods.disabled"] : ["user", "mods"];
    fs.mkdirSync(path.join(raiz, ...dir, p.nome), { recursive: true });
  }
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-forge-match.json"), JSON.stringify(c.cache ?? {}));
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-registry.json"), JSON.stringify(c.registro ?? []));
  return raiz;
}

const idsDe = (raiz: string) => [...installedForgeIds(raiz).keys()].sort();

// ---------------------------------------------------------------------------
console.log("\no disco manda");
// ---------------------------------------------------------------------------
{
  const raiz = monta({
    pastasCliente: [{ nome: "DrakiaXYZ-Waypoints" }],
    cache: {
      "DrakiaXYZ-Waypoints": { ids: { "sp-mod": "100" } },
      // Removido numa versão antiga, que não limpava o cache.
      "DrakiaXYZ-BigBrain": { ids: { "sp-mod": "200" } }
    }
  });
  check("pasta presente conta, pasta ausente nao", idsDe(raiz), ["100"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta({
    pastasServidor: [{ nome: "SAIN-ServerMod" }],
    registro: [
      { id: "SAIN-ServerMod", type: "server", forgeId: 300, forgeSourceKey: "sp-mod", forgeVersion: "4.5.0" },
      // Pasta apagada na mão, fora do app: o registro ficou.
      { id: "ModFantasma", type: "server", forgeId: 400, forgeSourceKey: "sp-mod" }
    ]
  });
  check("o mesmo vale pro registro", idsDe(raiz), ["300"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nmod desabilitado continua instalado");
// ---------------------------------------------------------------------------
{
  const raiz = monta({
    pastasCliente: [{ nome: "ModDesligado", habilitado: false }],
    cache: { ModDesligado: { ids: { "sp-mod": "500" } } }
  });
  check("pasta de desabilitados do cliente conta", idsDe(raiz), ["500"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta({
    pastasServidor: [{ nome: "ServidorDesligado", habilitado: false }],
    cache: { ServidorDesligado: { ids: { "sp-mod": "600" } } }
  });
  check("pasta de desabilitados do servidor tambem", idsDe(raiz), ["600"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nversao instalada vem junto");
// ---------------------------------------------------------------------------
{
  const raiz = monta({
    pastasServidor: [{ nome: "SAIN-ServerMod" }],
    cache: { "SAIN-ServerMod": { ids: { "sp-mod": "300" } } },
    registro: [{ id: "SAIN-ServerMod", type: "server", forgeVersion: "4.5.0" }]
  });
  check("le a versao gravada no registro", installedForgeIds(raiz).get("300"), "4.5.0");
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\noutra fonte nao vaza");
// ---------------------------------------------------------------------------
{
  const raiz = monta({
    pastasServidor: [{ nome: "ModDeOutraFonte" }],
    registro: [{ id: "ModDeOutraFonte", type: "server", forgeId: 700, forgeSourceKey: "forge-alt" }]
  });
  check("id de fonte diferente da ativa e ignorado", idsDe(raiz), []);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\ninstalacao dividida");
// ---------------------------------------------------------------------------
{
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-split-"));
  const servidor = path.join(raiz, "SPT_Runtime");
  fs.mkdirSync(path.join(servidor, "user", "mods", "ModDoServidor"), { recursive: true });
  fs.writeFileSync(
    path.join(raiz, ".spt-mod-manager-forge-match.json"),
    JSON.stringify({ ModDoServidor: { ids: { "sp-mod": "800" } } })
  );
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-registry.json"), "[]");
  check("sem a raiz do servidor, nao acha", [...installedForgeIds(raiz).keys()], []);
  check("com a raiz do servidor, acha", [...installedForgeIds(raiz, servidor).keys()], ["800"]);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nnao pode quebrar com arquivo faltando ou corrompido");
// ---------------------------------------------------------------------------
{
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-vazio-"));
  check("instancia sem arquivo nenhum devolve vazio", [...installedForgeIds(raiz).keys()], []);
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-forge-match.json"), "{ isto nao e json");
  check("cache corrompido nao estoura", [...installedForgeIds(raiz).keys()], []);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
