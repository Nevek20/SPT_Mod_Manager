/**
 * O que acontece com o que JÁ ESTAVA instalado quando um mod é atualizado.
 *
 * Dois relatos com a mesma raiz — a instalação copiava sem olhar o estado
 * anterior:
 *
 *   - doktorstick: "updating a disabled mod re-enables it". A cópia sempre
 *     escreve nas pastas de ativos.
 *   - trex0113: um mod que muda a estrutura de pastas acaba instalado DUAS
 *     vezes, porque a pasta antiga fica intacta ao lado da nova.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { reconciliarComAnterior } from "../electron/modManager";

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

const DIRS = {
  server: { true: ["user", "mods"], false: ["user", "mods.disabled"] },
  client: { true: ["BepInEx", "plugins"], false: ["BepInEx", "plugins.disabled"] }
} as const;

function monta(pastas: { id: string; type: "server" | "client"; enabled: boolean }[]): string {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-upd-"));
  for (const p of pastas) {
    const dir = DIRS[p.type][String(p.enabled) as "true" | "false"];
    fs.mkdirSync(path.join(raiz, ...dir, p.id), { recursive: true });
  }
  fs.writeFileSync(path.join(raiz, ".spt-mod-manager-registry.json"), "[]");
  return raiz;
}
const existe = (raiz: string, id: string, type: "server" | "client", enabled: boolean) =>
  fs.existsSync(path.join(raiz, ...DIRS[type][String(enabled) as "true" | "false"], id));

// ---------------------------------------------------------------------------
console.log("\npasta que mudou de nome entre versoes");
// ---------------------------------------------------------------------------
{
  // A nova ja foi copiada pelo instalador; a antiga e o que sobrou.
  const raiz = monta([
    { id: "TraumaCare", type: "server", enabled: true },
    { id: "TraumaCore", type: "server", enabled: true }
  ]);
  const r = reconciliarComAnterior(
    raiz, raiz,
    [{ id: "TraumaCare", type: "server", enabled: true }],
    [{ id: "TraumaCore", type: "server" }]
  );
  check("apaga a pasta antiga", existe(raiz, "TraumaCare", "server", true), false);
  check("mantem a nova", existe(raiz, "TraumaCore", "server", true), true);
  check("e reporta quantas saíram", r.pastasAntigasRemovidas, 1);
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  // Mesmo nome nas duas versoes: nao pode apagar nada.
  const raiz = monta([{ id: "MeuMod", type: "server", enabled: true }]);
  const r = reconciliarComAnterior(
    raiz, raiz,
    [{ id: "MeuMod", type: "server", enabled: true }],
    [{ id: "MeuMod", type: "server" }]
  );
  check("nome igual: nao apaga a propria instalacao", existe(raiz, "MeuMod", "server", true), true);
  check("e nao reporta remocao", r.pastasAntigasRemovidas, 0);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nestado desabilitado sobrevive a atualizacao");
// ---------------------------------------------------------------------------
{
  const raiz = monta([{ id: "TraumaCore", type: "server", enabled: true }]);
  const r = reconciliarComAnterior(
    raiz, raiz,
    [{ id: "TraumaCore", type: "server", enabled: false }],
    [{ id: "TraumaCore", type: "server" }]
  );
  check("volta pra pasta de desabilitados", existe(raiz, "TraumaCore", "server", false), true);
  check("e sai da de ativos", existe(raiz, "TraumaCore", "server", true), false);
  check("reporta que manteve desligado", r.mantidasDesabilitadas, 1);
  fs.rmSync(raiz, { recursive: true, force: true });
}

{
  const raiz = monta([{ id: "MeuMod", type: "client", enabled: true }]);
  reconciliarComAnterior(
    raiz, raiz,
    [{ id: "MeuMod", type: "client", enabled: true }],
    [{ id: "MeuMod", type: "client" }]
  );
  check("mod que estava ligado continua ligado", existe(raiz, "MeuMod", "client", true), true);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\npacote de duas partes com estados diferentes");
// ---------------------------------------------------------------------------
{
  // O caso que mais me preocupava: metades em estados diferentes.
  const raiz = monta([
    { id: "ModServer", type: "server", enabled: true },
    { id: "ModClient", type: "client", enabled: true }
  ]);
  reconciliarComAnterior(
    raiz, raiz,
    [
      { id: "ModServer", type: "server", enabled: false },
      { id: "ModClient", type: "client", enabled: true }
    ],
    [{ id: "ModServer", type: "server" }, { id: "ModClient", type: "client" }]
  );
  check("a metade que estava desligada volta a ficar", existe(raiz, "ModServer", "server", false), true);
  check("a que estava ligada continua ligada", existe(raiz, "ModClient", "client", true), true);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\ninstalacao nova (sem estado anterior) nao muda nada");
// ---------------------------------------------------------------------------
{
  const raiz = monta([{ id: "MeuMod", type: "server", enabled: true }]);
  const r = reconciliarComAnterior(raiz, raiz, [], [{ id: "MeuMod", type: "server" }]);
  check("nada removido", r.pastasAntigasRemovidas, 0);
  check("nada desabilitado", r.mantidasDesabilitadas, 0);
  check("a pasta continua onde estava", existe(raiz, "MeuMod", "server", true), true);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\nmetade que nao veio no pacote novo fica em paz");
// ---------------------------------------------------------------------------
{
  // Antes era pacote de duas partes, a nova versao so tem a de server.
  // A metade client nao pode ser apagada: pode ter virado mod independente.
  const raiz = monta([
    { id: "ModServer", type: "server", enabled: true },
    { id: "ModClient", type: "client", enabled: true }
  ]);
  reconciliarComAnterior(
    raiz, raiz,
    [
      { id: "ModServer", type: "server", enabled: true },
      { id: "ModClient", type: "client", enabled: true }
    ],
    [{ id: "ModServer", type: "server" }]
  );
  check("a metade ausente do pacote novo continua la", existe(raiz, "ModClient", "client", true), true);
  fs.rmSync(raiz, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log("\npasta antiga que ja estava desabilitada tambem sai");
// ---------------------------------------------------------------------------
{
  const raiz = monta([
    { id: "NomeVelho", type: "server", enabled: false },
    { id: "NomeNovo", type: "server", enabled: true }
  ]);
  const r = reconciliarComAnterior(
    raiz, raiz,
    [{ id: "NomeVelho", type: "server", enabled: false }],
    [{ id: "NomeNovo", type: "server" }]
  );
  check("acha a antiga na pasta de desabilitados", existe(raiz, "NomeVelho", "server", false), false);
  check("e o novo herda o estado desligado", existe(raiz, "NomeNovo", "server", false), true);
  check("contou a remocao", r.pastasAntigasRemovidas, 1);
  fs.rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
