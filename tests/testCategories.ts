/**
 * Categorias da lista (0.7.0).
 *
 * O que não pode quebrar:
 * - um pacote de server + client fica INTEIRO numa categoria só;
 * - "Minhas categorias" nasce como cópia das da fonte, com cada mod no lugar;
 * - apagar uma categoria nunca some com mod: ele volta pra "Sem categoria";
 * - lixo no arquivo (ou vindo da interface) é descartado sem derrubar a lista;
 * - a fonte só é consultada pelos ids que ainda não estão guardados.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { buildModTree } from "../src/modTree";
import {
  UNCATEGORIZED,
  groupNodes,
  seedFromSource,
  assignNodes,
  removeCategory,
  renameCategory,
  moveCategory
} from "../src/modCategories";
import { validaCustom, saveCustomCategories, loadCustomCategories, fetchModCategories } from "../electron/modManager";
import type { ModInfo } from "../src/types";

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

const mod = (id: string, type: ModInfo["type"], extra: Partial<ModInfo> = {}): ModInfo => ({
  id,
  name: id,
  originalName: id,
  type,
  enabled: true,
  installedManually: false,
  loadOrder: 0,
  ...extra
});

const mods: ModInfo[] = [
  mod("BigBrain", "client", { forgeModId: 902 }),
  mod("SAIN-Server", "server", { forgeModId: 791, packageId: "src:sp-mod:791" }),
  mod("SAIN", "client", { forgeModId: 791, packageId: "src:sp-mod:791" }),
  mod("Painter", "server", { forgeModId: 1025 }),
  mod("FeitoAMao", "server")
];
const titulos = { "902": "Bots", "791": "Bots", "1025": "Traders" };
const arvore = buildModTree(mods, "all");
const nomes = (g: ReturnType<typeof groupNodes>) => g.map((x) => [x.id === UNCATEGORIZED ? "(sem)" : x.name, x.nodes.map((n) => n.name)]);

// ---------------------------------------------------------------------------
console.log("\nsem agrupamento");
// ---------------------------------------------------------------------------
check("um grupo so, com tudo na ordem", groupNodes(arvore, "none", titulos, { categories: [], assign: {} })[0].nodes.length, 4);

// ---------------------------------------------------------------------------
console.log("\ncategoria da fonte");
// ---------------------------------------------------------------------------
{
  const g = groupNodes(arvore, "source", titulos, { categories: [], assign: {} });
  check("agrupa pela categoria, alfabetico, sem categoria no fim", nomes(g), [
    ["Bots", ["BigBrain", "SAIN"]],
    ["Traders", ["Painter"]],
    ["(sem)", ["FeitoAMao"]]
  ]);
  check("o pacote do SAIN e UMA linha, nao duas", g[0].nodes.find((n) => n.name === "SAIN")?.parts.length, 2);
  check(
    "sem titulos ainda (rede lenta), tudo cai em sem categoria sem quebrar",
    nomes(groupNodes(arvore, "source", {}, { categories: [], assign: {} })),
    [["(sem)", ["BigBrain", "SAIN", "Painter", "FeitoAMao"]]]
  );
}

// ---------------------------------------------------------------------------
console.log("\nminhas categorias");
// ---------------------------------------------------------------------------
{
  const semente = seedFromSource(arvore, titulos);
  check("semente copia as categorias da fonte", semente.categories.map((c) => c.name), ["Bots", "Traders"]);
  check("e ja poe cada linha no lugar", nomes(groupNodes(arvore, "custom", titulos, semente)), [
    ["Bots", ["BigBrain", "SAIN"]],
    ["Traders", ["Painter"]],
    ["(sem)", ["FeitoAMao"]]
  ]);

  const bots = semente.categories[0].id;
  const traders = semente.categories[1].id;
  const chaveSain = arvore.find((n) => n.name === "SAIN")!.key;
  const chaveMao = arvore.find((n) => n.name === "FeitoAMao")!.key;

  const movido = assignNodes(semente, [chaveMao], traders);
  check("mover poe na categoria escolhida", nomes(groupNodes(arvore, "custom", titulos, movido))[1], ["Traders", ["Painter", "FeitoAMao"]]);
  check(
    "mover pra sem categoria tira a atribuicao",
    assignNodes(movido, [chaveSain], UNCATEGORIZED).assign[chaveSain],
    undefined
  );

  const semBots = removeCategory(semente, bots);
  check("apagar a categoria some com ela", semBots.categories.map((c) => c.name), ["Traders"]);
  check(
    "e os mods dela voltam pra sem categoria, nenhum some",
    nomes(groupNodes(arvore, "custom", titulos, semBots)),
    [
      ["Traders", ["Painter"]],
      ["(sem)", ["BigBrain", "SAIN", "FeitoAMao"]]
    ]
  );

  check("renomear troca so o nome", renameCategory(semente, bots, "  IA  ").categories[0], { id: bots, name: "IA" });
  check("renomear pra vazio nao muda nada", renameCategory(semente, bots, "   ").categories[0].name, "Bots");
  check("descer troca a ordem", moveCategory(semente, bots, 1).categories.map((c) => c.name), ["Traders", "Bots"]);
  check("subir a primeira nao faz nada", moveCategory(semente, bots, -1).categories.map((c) => c.name), ["Bots", "Traders"]);

  const vazia = { categories: [...semente.categories, { id: "nova", name: "Nova" }], assign: semente.assign };
  check(
    "categoria vazia continua aparecendo (senao nao da pra mover nada pra ela)",
    nomes(groupNodes(arvore, "custom", titulos, vazia))[2],
    ["Nova", []]
  );
}

// ---------------------------------------------------------------------------
console.log("\nvalidacao do que vem do disco ou da interface");
// ---------------------------------------------------------------------------
{
  const lixo = {
    categories: [
      { id: "a", name: "Boa" },
      { id: "a", name: "Repetida" },
      { id: "", name: "Sem id" },
      { id: "b", name: "   " },
      "texto solto",
      { id: "c", name: "x".repeat(200) }
    ],
    assign: { linha1: "a", linha2: "nao-existe", linha3: 42 }
  };
  const v = validaCustom(lixo);
  check("fica so com as categorias validas", v.categories.map((c) => c.id), ["a", "c"]);
  check("nome gigante e cortado", v.categories[1].name.length, 80);
  check("atribuicao pra categoria inexistente e descartada", v.assign, { linha1: "a" });
  check("nada aproveitavel vira estrutura vazia", validaCustom("bobagem"), { categories: [], assign: {} });
}

// ---------------------------------------------------------------------------
async function main() {
  console.log("\narquivo da instancia");
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "spt-cat-"));
  try {
    check("sem arquivo, comeca vazio", loadCustomCategories(raiz), { categories: [], assign: {} });
    saveCustomCategories(raiz, { categories: [{ id: "x", name: "Minhas" }], assign: { k: "x" } });
    check("grava e le de volta", loadCustomCategories(raiz), { categories: [{ id: "x", name: "Minhas" }], assign: { k: "x" } });

    fs.writeFileSync(path.join(raiz, ".spt-mod-manager-categories.json"), "{ corrompido");
    check("arquivo corrompido nao derruba nada", loadCustomCategories(raiz), { categories: [], assign: {} });

    console.log("\ncategoria da fonte guardada");
    const pedidos: string[] = [];
    (globalThis as { fetch: unknown }).fetch = async (entrada: unknown) => {
      const u = new URL(String(entrada));
      pedidos.push(u.searchParams.get("filter[id]") ?? "");
      const ids = (u.searchParams.get("filter[id]") ?? "").split(",");
      const data = ids.map((id) => ({ id: Number(id), category: { title: id === "902" ? "Bots" : "Traders" } }));
      return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { "content-type": "application/json" } });
    };
    fs.rmSync(path.join(raiz, ".spt-mod-manager-categories.json"));

    const primeira = await fetchModCategories(raiz, [902, 1025]);
    check("pergunta a fonte e devolve os titulos", primeira, { "902": "Bots", "1025": "Traders" });
    check("numa requisicao so", pedidos.length, 1);

    const segunda = await fetchModCategories(raiz, [902, 1025]);
    check("na segunda vez, nao pergunta de novo", pedidos.length, 1);
    check("e devolve o mesmo", segunda, primeira);

    await fetchModCategories(raiz, [902, 1025, 791]);
    check("mod novo: pergunta so por ele", pedidos[1], "791");

    saveCustomCategories(raiz, { categories: [{ id: "x", name: "Minhas" }], assign: {} });
    const depois = await fetchModCategories(raiz, [902]);
    check("gravar as minhas nao apaga o cache da fonte", depois, { "902": "Bots" });
    check("e o cache da fonte nao apaga as minhas", loadCustomCategories(raiz).categories.length, 1);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }

  console.log(`\n${ok} ok, ${fail} falhas`);
  process.exit(fail ? 1 : 0);
}

void main();
