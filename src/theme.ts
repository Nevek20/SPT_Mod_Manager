/**
 * Temas, cor de destaque e modo daltônico.
 *
 * O CSS (App.css) só troca variáveis por atributo no <html>:
 *   data-theme  -> o tema efetivo ("system" vira dark ou light);
 *   data-cvd    -> "on" troca as cores de status por um par azul/laranja;
 *   data-accent -> "custom" quando a pessoa escolheu a própria cor de destaque.
 *
 * O modo daltônico é separado do tema de propósito: quem tem daltonismo não
 * precisa abrir mão do tema de que gosta. Verde x vermelho (ativo x
 * desativado, atualização x erro) é justamente o par que deuteranopia e
 * protanopia confundem; azul x laranja é o par que todos os tipos comuns
 * distinguem (paleta de Okabe-Ito).
 */

export type TemaEscolhido = "system" | "dark" | "light" | "sand" | "black" | "olive" | "contrast";
export type TemaEfetivo = Exclude<TemaEscolhido, "system">;

/** Ordem do seletor nas configurações. */
export const TEMAS: TemaEscolhido[] = ["system", "dark", "light", "sand", "black", "olive", "contrast"];

export function ehTema(v: unknown): v is TemaEscolhido {
  return typeof v === "string" && (TEMAS as string[]).includes(v);
}

export function temaEfetivo(tema: TemaEscolhido, sistemaEscuro: boolean): TemaEfetivo {
  if (tema === "system") return sistemaEscuro ? "dark" : "light";
  return tema;
}

/** Temas de fundo claro. Decide pra que lado a cor de destaque é ajustada. */
export function ehClaro(tema: TemaEfetivo): boolean {
  return tema === "light" || tema === "sand";
}

/**
 * Cores de amostra de cada tema (fundo, painel, destaque, texto), pro seletor
 * mostrar o tema sem precisar aplicar. Têm que bater com o App.css.
 */
export const AMOSTRAS: Record<TemaEfetivo, { bg: string; panel: string; accent: string; text: string }> = {
  dark: { bg: "#12151b", panel: "#1b1f26", accent: "#c8752e", text: "#e8e9ec" },
  light: { bg: "#eef0f3", panel: "#ffffff", accent: "#b0611d", text: "#1b1f26" },
  sand: { bg: "#e9e2d6", panel: "#f8f4ec", accent: "#b0611d", text: "#2a241b" },
  black: { bg: "#000000", panel: "#0b0b0b", accent: "#c8752e", text: "#e6e6e6" },
  olive: { bg: "#191b14", panel: "#22251b", accent: "#c4a35a", text: "#e6e3d3" },
  contrast: { bg: "#000000", panel: "#000000", accent: "#ffb347", text: "#ffffff" }
};

/** Sugestões de cor de destaque. A pessoa ainda pode escolher qualquer outra. */
export const ACCENT_PRESETS: { id: string; hex: string }[] = [
  { id: "amber", hex: "#c8752e" },
  { id: "red", hex: "#c0443a" },
  { id: "green", hex: "#5f9a4a" },
  { id: "teal", hex: "#2f9c95" },
  { id: "blue", hex: "#3d7fc4" },
  { id: "purple", hex: "#8a63c9" },
  { id: "pink", hex: "#c2578f" },
  { id: "khaki", hex: "#b59a5b" }
];

/** "#abc" ou "#aabbcc" (qualquer caixa) -> "#aabbcc"; o resto -> null. */
export function hexValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

function rgb(hex: string): [number, number, number] {
  const h = hexValido(hex) ?? "#000000";
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function paraHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mistura a com b; peso = quanto de b (0 a 1). */
export function misturar(a: string, b: string, peso: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return paraHex([ar + (br - ar) * peso, ag + (bg - ag) * peso, ab + (bb - ab) * peso]);
}

/** Luminância relativa (WCAG 2.x). */
export function luminancia(hex: string): number {
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Razão de contraste WCAG entre duas cores (1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Aproxima a cor do preto (fundo claro) ou do branco (fundo escuro) até ela
 * ter o contraste pedido contra o fundo. O destaque aparece como TEXTO
 * (títulos de seção, links, selos), então um amarelo-claro escolhido no tema
 * Claro ficaria ilegível; aqui ele vira um amarelo-escuro, mesmo matiz.
 */
export function ajustarContraste(cor: string, fundo: string, alvo: number): string {
  if (contraste(cor, fundo) >= alvo) return cor;
  const extremo = luminancia(fundo) > 0.4 ? "#000000" : "#ffffff";
  for (let passo = 1; passo <= 20; passo++) {
    const tentativa = misturar(cor, extremo, passo / 20);
    if (contraste(tentativa, fundo) >= alvo) return tentativa;
  }
  return extremo;
}

export interface CoresDeDestaque {
  accent: string;
  accentStrong: string;
  /** Texto em cima do destaque (botão primário). */
  onAccent: string;
}

/**
 * As três variáveis que dependem da cor escolhida. As derivadas (fundo
 * translúcido, borda, barra de seleção) o CSS calcula com color-mix a partir
 * de --accent.
 */
export function coresDeDestaque(escolhida: string, tema: TemaEfetivo): CoresDeDestaque {
  const painel = AMOSTRAS[tema].panel;
  // 3:1 é o mínimo do WCAG pra texto grande e elementos de interface; o alto
  // contraste pede o de texto normal.
  const accent = ajustarContraste(hexValido(escolhida) ?? AMOSTRAS[tema].accent, painel, tema === "contrast" ? 4.5 : 3);
  // Hover: um pouco mais perto do texto do tema (mais claro no escuro, mais
  // escuro no claro), que é o que os temas fixos já fazem.
  //
  // Texto do botão: escuro nos temas escuros e branco nos claros, como os
  // temas fixos. Cor média (um azul, um vermelho) não chega a 4,5:1 com
  // nenhum dos dois; aí o botão é empurrado pro lado que já ajuda o resto do
  // tema (mais claro no escuro, mais escuro no claro), até chegar.
  const onAccent = ehClaro(tema) ? "#ffffff" : tema === "contrast" ? "#000000" : "#1a1509";
  const botao = ajustarContraste(accent, onAccent, 4.5);
  const accentStrong = ajustarContraste(misturar(botao, ehClaro(tema) ? "#000000" : "#ffffff", 0.15), onAccent, 4.5);
  return { accent: botao, accentStrong, onAccent };
}
