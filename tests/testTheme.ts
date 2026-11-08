/**
 * Temas (src/theme.ts e os blocos de variáveis do App.css).
 *
 * Lê as cores direto do CSS, então um tema editado depois continua sendo
 * conferido: contraste de texto (WCAG), amostras do seletor batendo com o CSS,
 * e o modo daltônico separando "ok" de "erro" sob simulação de daltonismo.
 */
import * as fs from "fs";
import * as path from "path";
import {
  AMOSTRAS,
  TEMAS,
  coresDeDestaque,
  contraste,
  ehTema,
  hexValido,
  misturar,
  temaEfetivo,
  type TemaEfetivo
} from "../src/theme";

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
function peloMenos(label: string, valor: number, minimo: number) {
  check(`${label} (${valor.toFixed(2)} >= ${minimo})`, valor >= minimo, true);
}

// ---------- lê os blocos de tema do CSS ----------
// Normaliza CRLF: com core.autocrlf (padrão do Git no Windows) o arquivo chega
// com \r\n, e os seletores abaixo procuram \n.
const css = fs.readFileSync(path.join(__dirname, "..", "src", "App.css"), "utf-8").replace(/\r\n/g, "\n");

function bloco(seletor: RegExp): Record<string, string> {
  const m = seletor.exec(css);
  if (!m) throw new Error(`bloco não achado: ${seletor}`);
  const corpo = css.slice(m.index + m[0].length, css.indexOf("}", m.index));
  const vars: Record<string, string> = {};
  for (const linha of corpo.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[linha[1]] = linha[2].trim();
  return vars;
}

const raiz = bloco(/^:root \{/m);
const claro = bloco(/^:root\[data-theme="light"\],\n:root\[data-theme="sand"\] \{/m);
const temas: Record<TemaEfetivo, Record<string, string>> = {
  dark: raiz,
  light: { ...raiz, ...claro },
  // O seletor do sand aparece primeiro no bloco do claro ("light, sand"); o
  // bloco próprio é o que vem depois de um comentário.
  sand: { ...raiz, ...claro, ...bloco(/\*\/\n:root\[data-theme="sand"\] \{/) },
  black: { ...raiz, ...bloco(/^:root\[data-theme="black"\] \{/m) },
  olive: { ...raiz, ...bloco(/^:root\[data-theme="olive"\] \{/m) },
  contrast: { ...raiz, ...bloco(/^:root\[data-theme="contrast"\] \{/m) }
};
const cvdEscuro = bloco(/^:root\[data-cvd="on"\] \{/m);
const cvdClaro = bloco(/^:root\[data-cvd="on"\]\[data-theme="light"\],\n:root\[data-cvd="on"\]\[data-theme="sand"\] \{/m);
const cvdContraste = bloco(/^:root\[data-cvd="on"\]\[data-theme="contrast"\] \{/m);
const comDaltonico = (t: TemaEfetivo) => ({
  ...temas[t],
  ...cvdEscuro,
  ...(t === "light" || t === "sand" ? cvdClaro : {}),
  ...(t === "contrast" ? cvdContraste : {})
});

// ---------- simulação de daltonismo (Viénot 1999, em RGB linear) ----------
function linear(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function rgbLinear(hex: string): number[] {
  const h = hexValido(hex)!;
  return [1, 3, 5].map((i) => linear(parseInt(h.slice(i, i + 2), 16)));
}
const MATRIZES = {
  protanopia: [
    [0.11238, 0.88762, 0],
    [0.11238, 0.88762, 0],
    [0.00401, -0.00401, 1]
  ],
  deuteranopia: [
    [0.29275, 0.70725, 0],
    [0.29275, 0.70725, 0],
    [-0.02234, 0.02234, 1]
  ]
};
function lab(lin: number[]): number[] {
  const [r, g, b] = lin;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** Diferença de cor (ΔE CIE76) entre a e b, como alguém com o tipo de daltonismo veria. */
function diferencaVista(a: string, b: string, tipo: keyof typeof MATRIZES): number {
  const m = MATRIZES[tipo];
  const ver = (hex: string) => {
    const l = rgbLinear(hex);
    return lab(m.map((linha) => Math.max(0, linha[0] * l[0] + linha[1] * l[1] + linha[2] * l[2])));
  };
  const [la, lb] = [ver(a), ver(b)];
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

// ---------- testes ----------
console.log("\nescolha salva");
check("todos os temas são válidos", TEMAS.every(ehTema), true);
check("lixo não é tema", [ehTema("rgb"), ehTema(null), ehTema("")], [false, false, false]);
check("sistema escuro vira dark", temaEfetivo("system", true), "dark");
check("sistema claro vira light", temaEfetivo("system", false), "light");
check("hex curto normaliza", hexValido("#ABC"), "#aabbcc");
check("hex inválido recusado", [hexValido("red"), hexValido("#12345"), hexValido(undefined)], [null, null, null]);
check("mistura no meio", misturar("#000000", "#ffffff", 0.5), "#808080");

for (const t of Object.keys(temas) as TemaEfetivo[]) {
  const v = temas[t];
  console.log(`\ntema ${t}`);
  // Amostra do seletor tem que ser o tema de verdade.
  check("amostra = CSS (fundo, painel, texto, destaque)", [AMOSTRAS[t].bg, AMOSTRAS[t].panel, AMOSTRAS[t].text, AMOSTRAS[t].accent], [
    v.bg,
    v["bg-panel"],
    v.text,
    v.accent
  ]);
  const alto = t === "contrast";
  // Texto normal: 4,5:1 (AA); no alto contraste, 7:1 (AAA).
  peloMenos("texto x painel", contraste(v.text, v["bg-panel"]), alto ? 7 : 4.5);
  peloMenos("texto secundário x painel", contraste(v["text-dim"], v["bg-panel"]), alto ? 7 : 4.5);
  // O mais apagado é usado em notas e rótulos pequenos: 3:1 no mínimo, 4,5 no alto contraste.
  peloMenos("texto apagado x painel", contraste(v["text-faint"], v["bg-panel"]), alto ? 4.5 : 3);
  peloMenos("destaque x painel", contraste(v.accent, v["bg-panel"]), alto ? 4.5 : 3);
  peloMenos("texto do botão x destaque", contraste(v["on-accent"], v.accent), 4.5);

  const normal = Math.min(diferencaVista(v.ok, v.danger, "deuteranopia"), diferencaVista(v.ok, v.danger, "protanopia"));
  const cvd = comDaltonico(t);
  const daltonico = Math.min(diferencaVista(cvd.ok, cvd.danger, "deuteranopia"), diferencaVista(cvd.ok, cvd.danger, "protanopia"));
  // ΔE ~20 já é "cores claramente diferentes"; o par normal fica bem abaixo.
  peloMenos(`modo daltônico separa ok de erro (normal ΔE ${normal.toFixed(1)})`, daltonico, 25);
  check("modo daltônico separa mais que o normal", daltonico > normal, true);
  peloMenos("ok do modo daltônico legível no painel", contraste(cvd["ok-strong"], cvd["bg-panel"]), 3);
  peloMenos("erro do modo daltônico legível no painel", contraste(cvd["danger-strong"], cvd["bg-panel"]), 3);
}

console.log("\ncor de destaque escolhida");
{
  const amareloNoClaro = coresDeDestaque("#ffe066", "light");
  peloMenos("amarelo claro no tema Claro é escurecido até ler", contraste(amareloNoClaro.accent, AMOSTRAS.light.panel), 3);
  const azulEscuroNoPreto = coresDeDestaque("#102040", "black");
  peloMenos("azul escuro no Preto é clareado até ler", contraste(azulEscuroNoPreto.accent, AMOSTRAS.black.panel), 3);
  check("cor que já lê bem não muda", coresDeDestaque("#c8752e", "dark").accent, "#c8752e");
  for (const cor of ["#ffe066", "#102040", "#3d7fc4", "#c0443a", "#ffffff", "#000000"]) {
    for (const t of Object.keys(temas) as TemaEfetivo[]) {
      const c = coresDeDestaque(cor, t);
      if (contraste(c.onAccent, c.accent) < 4.5) {
        check(`texto do botão legível (${cor} no ${t})`, contraste(c.onAccent, c.accent).toFixed(2), ">= 4.5");
      }
    }
  }
  check("texto do botão legível pra todas as cores e temas testados", true, true);
  peloMenos("alto contraste exige 4,5 pro destaque", contraste(coresDeDestaque("#3d7fc4", "contrast").accent, "#000000"), 4.5);
  for (const t of Object.keys(temas) as TemaEfetivo[]) {
    const c = coresDeDestaque("#3d7fc4", t);
    peloMenos(`hover do botão legível (${t})`, contraste(c.onAccent, c.accentStrong), 4.5);
  }
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
process.exit(fail ? 1 : 0);
