/**
 * Converte o changelog que a fonte manda (HTML gerado de Markdown pelo autor do
 * mod) numa árvore simples que o React desenha.
 *
 * Por que não dangerouslySetInnerHTML: o texto é escrito por qualquer autor de
 * mod e roda dentro do Electron. Aqui nada vira HTML de verdade: só tags de uma
 * lista fechada viram elementos, sem nenhum atributo além do href (que nem é
 * clicável), e todo o resto vira texto, que o React escapa. Um HTML malicioso ou
 * quebrado, no pior caso, aparece como texto estranho.
 *
 * Puro e sem DOM, pra rodar nos testes.
 */

export type ChangelogTag =
  | "p"
  | "ul"
  | "ol"
  | "li"
  | "strong"
  | "em"
  | "del"
  | "code"
  | "pre"
  | "blockquote"
  | "h"
  | "br"
  | "hr"
  | "a";

export interface ChangelogElement {
  tag: ChangelogTag;
  href?: string;
  children: ChangelogNode[];
}

export type ChangelogNode = string | ChangelogElement;

/** Tag da fonte -> tag nossa. O que não está aqui some, mas o texto de dentro fica. */
const MAPA: Record<string, ChangelogTag> = {
  p: "p",
  div: "p",
  ul: "ul",
  ol: "ol",
  li: "li",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  del: "del",
  s: "del",
  strike: "del",
  code: "code",
  pre: "pre",
  blockquote: "blockquote",
  h1: "h",
  h2: "h",
  h3: "h",
  h4: "h",
  h5: "h",
  h6: "h",
  br: "br",
  hr: "hr",
  a: "a",
  tr: "p"
};

/** Tags cujo CONTEÚDO também é descartado: não é texto pra ler. */
const DESCARTA_CONTEUDO = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "noscript",
  "textarea",
  "title",
  "head",
  "select",
  "button",
  "form"
]);

const VAZIAS = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "col", "area", "base"]);
const BLOCOS = new Set<ChangelogTag>(["p", "ul", "ol", "pre", "blockquote", "h", "hr"]);
/** Pai em que espaço solto entre filhos é só a quebra de linha do HTML. */
const SO_ESTRUTURA = new Set<ChangelogTag | "root">(["root", "ul", "ol", "blockquote"]);

const MAX_ENTRADA = 50_000;
const MAX_PROFUNDIDADE = 20;

const ENTIDADES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  rarr: "→",
  larr: "←",
  times: "×",
  middot: "·",
  bull: "•"
};

export function decodeEntities(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (inteiro, corpo: string) => {
    if (corpo[0] === "#") {
      const cp = corpo[1] === "x" || corpo[1] === "X" ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10);
      // Fora do Unicode, surrogate solto ou caractere nulo: deixa como estava.
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return inteiro;
      return String.fromCodePoint(cp);
    }
    return ENTIDADES[corpo.toLowerCase()] ?? inteiro;
  });
}

function atributo(attrs: string, nome: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${nome}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  if (!m) return undefined;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

/** Só http(s). javascript:, data:, file: e companhia viram link sem endereço. */
function hrefSeguro(bruto: string | undefined): string | undefined {
  if (!bruto) return undefined;
  const limpo = bruto.trim();
  return /^https?:\/\//i.test(limpo) ? limpo : undefined;
}

interface Aberto {
  tag: ChangelogTag | "root";
  /** Nome original no HTML, pra casar com a tag de fechamento. */
  origem: string;
  node: ChangelogElement;
}

export function parseChangelogHtml(html: string): ChangelogNode[] {
  const raiz: ChangelogElement = { tag: "p", children: [] };
  const pilha: Aberto[] = [{ tag: "root", origem: "", node: raiz }];
  const topo = () => pilha[pilha.length - 1];
  const dentroDePre = () => pilha.some((a) => a.tag === "pre");

  const empurraTexto = (bruto: string) => {
    if (!bruto) return;
    const pai = topo();
    let texto = decodeEntities(bruto);
    if (!dentroDePre()) {
      texto = texto.replace(/\s+/g, " ");
      if (texto === " " && SO_ESTRUTURA.has(pai.tag)) return;
    }
    const filhos = pai.node.children;
    const ultimo = filhos[filhos.length - 1];
    if (typeof ultimo === "string") filhos[filhos.length - 1] = ultimo + texto;
    else filhos.push(texto);
  };

  const fecha = (nome: string) => {
    for (let i = pilha.length - 1; i > 0; i--) {
      if (pilha[i].origem === nome) {
        pilha.length = i;
        return;
      }
    }
    // Fechamento sem abertura: ignora, como o navegador faria.
  };

  const entrada = html.length > MAX_ENTRADA ? html.slice(0, MAX_ENTRADA) : html;
  const token = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let pos = 0;
  let descartando: string | null = null;
  let m: RegExpExecArray | null;

  while ((m = token.exec(entrada))) {
    if (!descartando) empurraTexto(entrada.slice(pos, m.index));
    pos = token.lastIndex;
    if (m[0].startsWith("<!--")) continue;

    const fechamento = m[1] === "/";
    const nome = m[2].toLowerCase();
    const attrs = m[3] ?? "";

    if (descartando) {
      if (fechamento && nome === descartando) descartando = null;
      continue;
    }
    if (DESCARTA_CONTEUDO.has(nome)) {
      if (!fechamento && !attrs.trim().endsWith("/")) descartando = nome;
      continue;
    }

    if (fechamento) {
      fecha(nome);
      continue;
    }

    if (nome === "img") {
      // Imagem não carrega (seria um pedido de rede pra qualquer servidor):
      // fica o texto alternativo, se o autor escreveu um.
      const alt = atributo(attrs, "alt")?.trim();
      if (alt) empurraTexto(`[${alt}]`);
      continue;
    }
    if (nome === "td" || nome === "th") {
      // Tabela vira linha de texto: cada célula separada por espaço.
      const filhos = topo().node.children;
      if (filhos.length > 0) empurraTexto(" · ");
      continue;
    }

    const tag = MAPA[nome];
    if (!tag) continue; // tag desconhecida: some, o texto de dentro fica

    // Parágrafo não contém bloco, e item de lista novo fecha o anterior.
    if (BLOCOS.has(tag) && topo().tag === "p" && pilha.length > 1) pilha.pop();
    if (tag === "li" && topo().tag === "li") pilha.pop();

    const href = tag === "a" ? hrefSeguro(atributo(attrs, "href")) : undefined;
    const novo: ChangelogElement = href ? { tag, href, children: [] } : { tag, children: [] };

    if (pilha.length > MAX_PROFUNDIDADE) continue;
    topo().node.children.push(novo);
    if (!VAZIAS.has(nome) && tag !== "br" && tag !== "hr") {
      pilha.push({ tag, origem: nome, node: novo });
    }
  }
  if (!descartando) empurraTexto(entrada.slice(pos));

  return limpa(raiz.children);
}

/** Tira elemento vazio (um <p></p> sobrando) e espaço nas pontas dos blocos. */
function limpa(nodes: ChangelogNode[]): ChangelogNode[] {
  const out: ChangelogNode[] = [];
  for (const n of nodes) {
    if (typeof n === "string") {
      if (n !== "") out.push(n);
      continue;
    }
    if (n.tag !== "pre") n.children = limpa(n.children);
    if (n.tag !== "pre" && (BLOCOS.has(n.tag) || n.tag === "li")) aparaPontas(n.children);
    if (n.children.length === 0 && n.tag !== "br" && n.tag !== "hr") continue;
    out.push(n);
  }
  return out;
}

function aparaPontas(children: ChangelogNode[]) {
  if (typeof children[0] === "string") children[0] = children[0].replace(/^\s+/, "");
  const u = children.length - 1;
  if (u >= 0 && typeof children[u] === "string") children[u] = (children[u] as string).replace(/\s+$/, "");
  for (let i = children.length - 1; i >= 0; i--) if (children[i] === "") children.splice(i, 1);
}

/** Tem algum texto de verdade? Autor que não escreveu nada manda "" ou "<p></p>". */
export function changelogHasText(nodes: ChangelogNode[]): boolean {
  return nodes.some((n) => (typeof n === "string" ? n.trim() !== "" : changelogHasText(n.children)));
}
