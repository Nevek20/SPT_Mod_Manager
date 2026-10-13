/**
 * Filtro de compatibilidade da busca no catálogo.
 *
 * Três modos:
 * - "all": qualquer versão do SPT;
 * - "exact": só o que declara a versão da instância (ex.: 4.1.6);
 * - "minor": qualquer coisa da mesma linha (4.1.x). Pedido da comunidade: mod
 *   publicado pra 4.1.3 costuma rodar no 4.1.6, mas o filtro exato escondia,
 *   e desligar o filtro mostrava junto mod de 3.x que não roda mesmo.
 *
 * Conferido na API (out/2026): filter[spt_version] aceita faixa. Com 4.1.6
 * vinham 557 mods; com ~4.1.0, 610.
 */

export type CompatFilter = "all" | "exact" | "minor";

export function sptConstraintFor(mode: CompatFilter, instanceVersion: string): string | undefined {
  const v = instanceVersion.trim();
  if (!v || mode === "all") return undefined;
  if (mode === "exact") return v;
  const m = v.match(/^(\d+)\.(\d+)/);
  // Versão num formato inesperado: melhor filtrar exato do que não filtrar nada.
  return m ? `~${m[1]}.${m[2]}.0` : v;
}

/** "4.1.6" -> "4.1.x", pro texto da opção. */
export function minorLabel(instanceVersion: string): string {
  const m = instanceVersion.trim().match(/^(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.x` : instanceVersion.trim();
}
