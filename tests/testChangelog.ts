/**
 * Changelog antes de atualizar (pedido do trex0113, 0.7.0).
 *
 * Duas partes: quais versões entram (mais nova que a instalada, até a
 * recomendada) e a conversão do HTML do autor, que nunca pode virar HTML de
 * verdade dentro do app.
 */

import { parseChangelogHtml, changelogHasText, decodeEntities } from "../src/changelog";
import { selecionaVersoesChangelog } from "../electron/modManager";
import { translateBackendMessage } from "../src/i18n";

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
const p = parseChangelogHtml;
const json = (v: unknown) => JSON.stringify(v);

console.log("Seleção de versões");
const lista = ["0.6.4", "0.6.3", "0.6.2", "0.6.1", "0.6.0", "0.5.3"].map((v) => ({
  version: v,
  description: `<p>Release ${v}</p>`,
  published_at: "2026-10-01T00:00:00Z"
}));
const vers = (r: { entries: { version: string }[] }) => r.entries.map((e) => e.version);

check("entre a instalada (exclusive) e a recomendada (inclusive)", vers(selecionaVersoesChangelog(lista, "0.6.1", "0.6.4")), ["0.6.4", "0.6.3", "0.6.2"]);
check("recomendada abaixo da mais nova (bloqueio em cadeia)", vers(selecionaVersoesChangelog(lista, "0.6.0", "0.6.2")), ["0.6.2", "0.6.1"]);
check("sem recomendada: tudo acima da instalada", vers(selecionaVersoesChangelog(lista, "0.6.2", undefined)), ["0.6.4", "0.6.3"]);
check("sem instalada: só a recomendada", vers(selecionaVersoesChangelog(lista, undefined, "0.6.3")), ["0.6.3"]);
check("sem nenhuma das duas: nada", vers(selecionaVersoesChangelog(lista, undefined, undefined)), []);
check("já na recomendada: nada", vers(selecionaVersoesChangelog(lista, "0.6.4", "0.6.4")), []);
check("comparação numérica, não de texto", vers(selecionaVersoesChangelog([{ version: "1.10.0" }, { version: "1.9.0" }, { version: "1.2.0" }], "1.2.0", "1.10.0")), ["1.10.0", "1.9.0"]);
check("ordem da fonte bagunçada vira da mais nova pra mais velha", vers(selecionaVersoesChangelog([{ version: "1.1" }, { version: "1.3" }, { version: "1.2" }], "1.0", "1.3")), ["1.3", "1.2", "1.1"]);
check("versão repetida (reupload) aparece uma vez", vers(selecionaVersoesChangelog([{ version: "2.0.0" }, { version: "2.0.0" }], "1.0.0", "2.0.0")), ["2.0.0"]);
check("registro sem versão ou com lixo é ignorado", vers(selecionaVersoesChangelog([{ version: null }, { version: 3 }, { version: " " }, { version: "1.1.0" }] as never, "1.0.0", "1.1.0")), ["1.1.0"]);
check("\"v\" na frente não atrapalha", vers(selecionaVersoesChangelog([{ version: "v1.1.0" }], "1.0.0", "1.1.0")), ["v1.1.0"]);
const muitas = Array.from({ length: 25 }, (_, i) => ({ version: `1.${25 - i}.0` }));
const limitado = selecionaVersoesChangelog(muitas, "1.0.0", "1.25.0");
check("limite de 10 versões", limitado.entries.length, 10);
check("o resto vira contagem de mais antigas", limitado.olderCount, 15);
check("descrição que não é texto vira vazia", selecionaVersoesChangelog([{ version: "1.1", description: { x: 1 } }], "1.0", "1.1").entries[0].html, "");

console.log("HTML comum de Markdown");
check("parágrafo", p("<p>Release 0.6.4</p>"), [{ tag: "p", children: ["Release 0.6.4"] }]);
check(
  "lista com quebras de linha entre as tags",
  p("<ul>\n<li>Um</li>\n<li>Dois</li>\n</ul>"),
  [{ tag: "ul", children: [{ tag: "li", children: ["Um"] }, { tag: "li", children: ["Dois"] }] }]
);
check(
  "negrito, itálico e código",
  p("<p><strong>Fix</strong>: <em>crash</em> em <code>Plugin.cs</code></p>"),
  [{ tag: "p", children: [{ tag: "strong", children: ["Fix"] }, ": ", { tag: "em", children: ["crash"] }, " em ", { tag: "code", children: ["Plugin.cs"] }] }]
);
check("b e i viram strong e em", p("<b>a</b><i>b</i>"), [{ tag: "strong", children: ["a"] }, { tag: "em", children: ["b"] }]);
check("h1 a h6 viram um título só", p("<h2>Changes</h2>"), [{ tag: "h", children: ["Changes"] }]);
check("pre mantém espaços e quebras", p("<pre><code>a  b\n  c</code></pre>"), [{ tag: "pre", children: [{ tag: "code", children: ["a  b\n  c"] }] }]);
check("espaços em texto normal colapsam", p("<p>a   \n  b</p>"), [{ tag: "p", children: ["a b"] }]);
check("br e hr", p("<p>a<br>b</p><hr>"), [{ tag: "p", children: ["a", { tag: "br", children: [] }, "b"] }, { tag: "hr", children: [] }]);
check("li sem fechamento", p("<ul><li>a<li>b</ul>"), [{ tag: "ul", children: [{ tag: "li", children: ["a"] }, { tag: "li", children: ["b"] }] }]);
check("lista aninhada", json(p("<ul><li>a<ul><li>b</li></ul></li></ul>")), json([{ tag: "ul", children: [{ tag: "li", children: ["a", { tag: "ul", children: [{ tag: "li", children: ["b"] }] }] }] }]));
check("texto solto sem tag", p("só texto"), ["só texto"]);

console.log("Entidades");
check("básicas", decodeEntities("&lt;b&gt; &amp; &quot;x&quot; &#39;y&#39;"), "<b> & \"x\" 'y'");
check("numéricas e hex", decodeEntities("&#8217;&#x2192;"), "’→");
check("fora do Unicode fica como está", decodeEntities("&#99999999;&#xD800;&#0;"), "&#99999999;&#xD800;&#0;");
check("desconhecida fica como está", decodeEntities("&naoexiste;"), "&naoexiste;");
check("&lt;script&gt; vira texto, não tag", p("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"), [{ tag: "p", children: ["<script>alert(1)</script>"] }]);

console.log("Segurança");
check("script some com o conteúdo", p("<p>a</p><script>alert(1)</script><p>b</p>"), [{ tag: "p", children: ["a"] }, { tag: "p", children: ["b"] }]);
check("style some com o conteúdo", p("<style>body{display:none}</style>ok"), ["ok"]);
check("iframe e svg somem", p("<iframe src='https://x'>x</iframe><svg><script>y</script></svg>z"), ["z"]);
check("script sem fechar engole o resto, não vaza", p("a<script>alert(1)"), ["a"]);
check("atributos de evento não passam", json(p('<p onclick="alert(1)" style="x">a</p>')), json([{ tag: "p", children: ["a"] }]));
check("link http mantém o endereço", p('<a href="https://github.com/x">repo</a>'), [{ tag: "a", href: "https://github.com/x", children: ["repo"] }]);
check("javascript: perde o endereço", p('<a href="javascript:alert(1)">x</a>'), [{ tag: "a", children: ["x"] }]);
check("javascript: com entidade também", p('<a href="&#106;avascript:alert(1)">x</a>'), [{ tag: "a", children: ["x"] }]);
check("data: perde o endereço", p("<a href='data:text/html,x'>x</a>"), [{ tag: "a", children: ["x"] }]);
check("imagem vira o texto alternativo", p('<p><img src="https://tracker/x.png" alt="screenshot"></p>'), [{ tag: "p", children: ["[screenshot]"] }]);
check("imagem sem alt some", p('<p>a<img src="https://tracker/x.png"></p>'), [{ tag: "p", children: ["a"] }]);
check("tag desconhecida some e o texto fica", p("<p><span class='x'>a</span><font>b</font></p>"), [{ tag: "p", children: ["ab"] }]);
check("comentário some", p("<p>a<!-- <script>x</script> -->b</p>"), [{ tag: "p", children: ["ab"] }]);
check("> dentro de atributo entre aspas não corta a tag", p('<a href="https://x" title="a>b">t</a>'), [{ tag: "a", href: "https://x", children: ["t"] }]);
check("< solto é texto", p("<p>1 < 2</p>"), [{ tag: "p", children: ["1 < 2"] }]);
check("fechamento sem abertura é ignorado", p("</ul></p>a"), ["a"]);
const fundo = "<blockquote>".repeat(200) + "x" + "</blockquote>".repeat(200);
check("aninhamento absurdo não estoura", changelogHasText(p(fundo)), true);
check("entrada gigante é cortada", (() => { const r = p("<p>" + "a".repeat(200_000) + "</p>"); return (r[0] as { children: string[] }).children[0].length <= 50_000; })(), true);

console.log("Vazio");
check("string vazia", changelogHasText(p("")), false);
check("só parágrafo vazio", changelogHasText(p("<p></p>\n<p> </p>")), false);
check("parágrafo vazio é removido", p("<p></p><p>a</p>"), [{ tag: "p", children: ["a"] }]);
check("com texto", changelogHasText(p("<ul><li>x</li></ul>")), true);

console.log("Mensagens do backend");
check(
  "erro do changelog com mensagem de dentro traduzida",
  translateBackendMessage("Couldn't load the changelog: sp-mod.com didn't respond.", "pt-BR"),
  "Não foi possível carregar o changelog: sp-mod.com não respondeu."
);
check(
  "status HTTP",
  translateBackendMessage("Couldn't load the changelog: sp-mod.com returned 503 for the changelog.", "pt-BR"),
  "Não foi possível carregar o changelog: sp-mod.com respondeu 503 ao pedir o changelog."
);
check("outros idiomas veem o inglês", translateBackendMessage("Couldn't load the changelog: x didn't respond.", "de"), "Couldn't load the changelog: x didn't respond.");

console.log(`\n${ok} ok, ${fail} falha(s)`);
if (fail) process.exit(1);
