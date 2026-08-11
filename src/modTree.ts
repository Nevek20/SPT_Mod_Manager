import type { ModInfo, ModType } from "./types";

export interface ModTreeNode {
  key: string;
  name: string;
  parts: ModInfo[];
  /** Partes escondidas pelo filtro de tipo. parts.length + hiddenParts = total real. */
  hiddenParts: number;
  /** Verdadeiro quando o agrupamento é palpite (mesmo nome / sufixo de papel), não registro. */
  inferred: boolean;
  /** Mod de parte única: a linha é o próprio mod, sem filhos. */
  single: boolean;
}

/**
 * Sufixos de papel que a inferência de pacote já usa pra agrupar. Repetidos aqui
 * porque o nome do pai precisa da mesma limpeza: sem isso, "MoreBotsServer" +
 * "MoreBotsAPI" viraria um pai chamado "MoreBotsServer", que é o nome de uma das
 * metades e não do mod.
 */
const ROLE_SUFFIXES = ["serverside", "clientside", "backend", "server", "client", "api"];

function stripRole(name: string): string {
  const lower = name.toLowerCase();
  for (const suffix of ROLE_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return name.slice(0, name.length - suffix.length).replace(/[-_. ]+$/, "");
    }
  }
  return name;
}

/**
 * Nome do pai, em cascata:
 *   1. forgeName de qualquer parte — é o nome publicado, e as duas metades vêm da
 *      mesma página, então basta uma parte tê-lo.
 *   2. o nome comum das partes, com o sufixo de papel removido.
 *   3. o nome da primeira parte, quando nem isso sobra.
 *
 * O forgeName vem por parte porque nem todo caminho de instalação o grava — daí
 * procurar entre as partes em vez de assumir que está na primeira.
 */
export function parentName(parts: ModInfo[]): string {
  // Mod de parte única mantém o nome da PASTA, sempre. A linha é aquela pasta, e
  // o usuário pode tê-la renomeado de propósito — trocar pelo nome publicado
  // apagaria essa escolha na cara dele.
  if (parts.length === 1) return parts[0].name;

  const fromForge = parts.map((p) => p.forgeName).find((n) => n && n.trim());
  if (fromForge) return fromForge.trim();

  const stripped = parts.map((p) => stripRole(p.name)).filter(Boolean);
  const first = stripped[0];
  if (first && stripped.every((s) => s.toLowerCase() === first.toLowerCase())) return first;

  // Nomes que não convergem (ex: "SAIN" + "Solarint-SAIN-ServerMod", onde o
  // sufixo "ServerMod" escapa da limpeza): fica com o MAIS CURTO, não com o
  // primeiro. A ordem das partes vem do scan e não é garantida, então usar a
  // primeira faria o rótulo mudar sozinho entre execuções. O mais curto também
  // costuma ser o nome do mod, já que as variantes ganham sufixo de papel.
  return [...stripped].sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? parts[0]?.name ?? "";
}

function groupKey(mod: ModInfo): string {
  // Sem packageId a linha é o próprio mod. Precisa do tipo na chave porque as duas
  // metades de um pacote podem ter o MESMO nome de pasta (o Wedge é assim).
  return mod.packageId ?? `solo:${mod.type}:${mod.id}`;
}

/**
 * Agrupa a lista plana em linhas-pai e aplica o filtro de tipo PODANDO as partes
 * que não casam (opção A): o mod continua na lista, mas mostra só a metade pedida.
 * Filtrar por "client" existe pra encurtar a lista — devolver o pacote inteiro
 * transformaria o filtro num marca-texto.
 *
 * A ordem importa: agrupar primeiro e podar depois, senão um pacote cuja metade
 * server foi filtrada nunca chegaria a formar um grupo.
 */
export function buildModTree(mods: ModInfo[], typeFilter: ModType | "all"): ModTreeNode[] {
  const groups = new Map<string, ModInfo[]>();
  for (const mod of mods) {
    const key = groupKey(mod);
    const bucket = groups.get(key);
    if (bucket) bucket.push(mod);
    else groups.set(key, [mod]);
  }

  const nodes: ModTreeNode[] = [];
  for (const [key, all] of groups) {
    const matching = typeFilter === "all" ? all : all.filter((m) => m.type === typeFilter);
    if (matching.length === 0) continue;

    nodes.push({
      key,
      name: parentName(all),
      parts: matching,
      hiddenParts: all.length - matching.length,
      inferred: key.startsWith("inferred:"),
      single: all.length === 1
    });
  }

  return nodes;
}