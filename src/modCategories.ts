/**
 * Agrupamento da lista em categorias.
 *
 * Três modos, escolhidos pelo usuário:
 * - "none": a lista de sempre, sem cabeçalhos;
 * - "source": a categoria que o catálogo dá a cada mod (Traders, Quests...);
 * - "custom": categorias criadas pelo usuário, estilo separadores do MO2. Começa
 *   com tudo em "Sem categoria": a organização é dele, não uma cópia da fonte.
 *
 * Trabalha em cima das LINHAS da árvore (ModTreeNode), não dos mods soltos: um
 * pacote de server + client é uma coisa só e não pode ficar com uma metade em
 * cada categoria.
 *
 * Separado do App.tsx pra ser testado sem interface.
 */

import type { ModTreeNode } from "./modTree";
import type { CustomCategories } from "./types";

export type GroupMode = "none" | "source" | "custom";

/** Id reservado do grupo "Sem categoria". Nunca é gravado como categoria. */
export const UNCATEGORIZED = "__uncategorized";

export interface CategoryGroup {
  id: string;
  /** Nome pra mostrar. Vazio no "Sem categoria", que a interface traduz. */
  name: string;
  nodes: ModTreeNode[];
}

/** Id do catálogo de uma linha: a primeira parte que tiver. */
export function forgeIdOf(node: ModTreeNode): number | undefined {
  for (const part of node.parts) if (part.forgeModId !== undefined) return part.forgeModId;
  return undefined;
}

/** Categoria da fonte de uma linha, ou undefined se o catálogo não conhece o mod. */
export function sourceCategoryOf(node: ModTreeNode, titles: Record<string, string>): string | undefined {
  const id = forgeIdOf(node);
  return id !== undefined ? titles[String(id)] : undefined;
}

/**
 * Separa as linhas em grupos, mantendo dentro de cada grupo a ordem que veio
 * (a ordenação escolhida na barra continua valendo).
 */
export function groupNodes(
  nodes: ModTreeNode[],
  mode: GroupMode,
  sourceTitles: Record<string, string>,
  custom: CustomCategories
): CategoryGroup[] {
  if (mode === "none") return [{ id: "__all", name: "", nodes }];

  const semCategoria: ModTreeNode[] = [];

  if (mode === "source") {
    const porTitulo = new Map<string, ModTreeNode[]>();
    for (const node of nodes) {
      const titulo = sourceCategoryOf(node, sourceTitles);
      if (!titulo) {
        semCategoria.push(node);
        continue;
      }
      const lista = porTitulo.get(titulo) ?? [];
      lista.push(node);
      porTitulo.set(titulo, lista);
    }
    // Ordem alfabética: a fonte não tem uma ordem "certa" das categorias, e
    // alfabética é a única que a pessoa consegue prever.
    const grupos = [...porTitulo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([titulo, lista]) => ({ id: `source:${titulo}`, name: titulo, nodes: lista }));
    if (semCategoria.length) grupos.push({ id: UNCATEGORIZED, name: "", nodes: semCategoria });
    return grupos;
  }

  // custom: a ordem das categorias é a que o usuário definiu, e categoria vazia
  // continua aparecendo, senão não teria como mover nada pra ela.
  const existentes = new Set(custom.categories.map((c) => c.id));
  const porId = new Map<string, ModTreeNode[]>(custom.categories.map((c) => [c.id, []]));
  for (const node of nodes) {
    const cat = custom.assign[node.key];
    if (cat && existentes.has(cat)) porId.get(cat)!.push(node);
    else semCategoria.push(node);
  }
  const grupos: CategoryGroup[] = custom.categories.map((c) => ({ id: c.id, name: c.name, nodes: porId.get(c.id)! }));
  // "Sem categoria" vazio é só ruído: quando tudo já está organizado, some.
  if (semCategoria.length) grupos.push({ id: UNCATEGORIZED, name: "", nodes: semCategoria });
  return grupos;
}

let contador = 0;
/** Id novo e estável depois de criado; o nome pode mudar à vontade. */
export function newCategoryId(base = "cat"): string {
  contador += 1;
  const limpo = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "cat";
  return `${limpo}-${Date.now().toString(36)}-${contador}`;
}

/** Move linhas pra uma categoria (ou pra "Sem categoria"). Devolve um objeto novo. */
export function assignNodes(custom: CustomCategories, nodeKeys: string[], categoryId: string): CustomCategories {
  const assign = { ...custom.assign };
  for (const key of nodeKeys) {
    if (categoryId === UNCATEGORIZED) delete assign[key];
    else assign[key] = categoryId;
  }
  return { categories: custom.categories, assign };
}

/** Apaga uma categoria; os mods dela voltam pra "Sem categoria", nada é removido do disco. */
export function removeCategory(custom: CustomCategories, categoryId: string): CustomCategories {
  const assign: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom.assign)) if (v !== categoryId) assign[k] = v;
  return { categories: custom.categories.filter((c) => c.id !== categoryId), assign };
}

export function renameCategory(custom: CustomCategories, categoryId: string, name: string): CustomCategories {
  const limpo = name.trim().slice(0, 80);
  if (!limpo) return custom;
  return { ...custom, categories: custom.categories.map((c) => (c.id === categoryId ? { ...c, name: limpo } : c)) };
}

/** Sobe ou desce uma categoria na ordem. */
export function moveCategory(custom: CustomCategories, categoryId: string, delta: -1 | 1): CustomCategories {
  const i = custom.categories.findIndex((c) => c.id === categoryId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= custom.categories.length) return custom;
  const categories = [...custom.categories];
  [categories[i], categories[j]] = [categories[j], categories[i]];
  return { ...custom, categories };
}
