/**
 * Confere os dicionários de tradução contra o inglês.
 *
 * Existe porque tradução vem de fora: com sete idiomas contribuídos por outras
 * pessoas, auditar de olho a cada versão não é viável. Este script pega os três
 * erros que passam despercebidos e só aparecem como interface quebrada:
 *
 *   1. chave faltando  -> a interface mostra a CHAVE crua ("browse.searchButton")
 *   2. chave inventada -> tradução que nunca é usada, e some numa refatoração
 *   3. placeholder trocado -> o {version} não é substituído e aparece literal
 *
 * O 3 é o pior: contagem de chaves bate, tudo parece certo, e o usuário vê
 * "{total}" no meio da frase. Foi exatamente o que apareceu na primeira
 * contribuição de chinês, em 3 das 33 chaves com placeholder.
 *
 * Uso:
 *   npx tsx verificaTraducoes.ts                  (usa src/i18n.ts)
 *   npx tsx verificaTraducoes.ts caminho/i18n.ts  (confere uma contribuição)
 *
 * Sai com código 1 se achar problema, pra poder virar passo de CI depois.
 */
import * as fs from "fs";
import * as path from "path";

const alvo = process.argv[2] || path.join("src", "i18n.ts");

if (!fs.existsSync(alvo)) {
  console.error(`Não achei ${alvo}`);
  process.exit(1);
}

const fonte = fs.readFileSync(alvo, "utf-8");

/** Extrai os dicionários lendo o arquivo como texto. */
function extrairDicionarios(texto: string): Map<string, Map<string, string>> {
  const dicionarios = new Map<string, Map<string, string>>();
  let atual: string | null = null;
  let pendente: string | null = null;

  for (const linha of texto.split("\n")) {
    const abre = linha.match(/^const (\w+)\s*:\s*Dict\s*=\s*\{/);
    if (abre) {
      atual = abre[1];
      dicionarios.set(atual, new Map());
      continue;
    }
    if (/^\};/.test(linha)) {
      atual = null;
      continue;
    }
    if (!atual) continue;

    // A chave pode vir com o valor na mesma linha ou na linha seguinte, e o valor
    // pode estar entre aspas duplas OU simples (o arquivo usa simples quando o
    // texto tem aspas duplas dentro). Ignorar essas formas fazia o verificador
    // pular 21 chaves em silêncio — pior que não verificar, porque dava a
    // impressão de ter conferido tudo.
    const soChave = linha.match(/^\s*"([a-zA-Z0-9_.]+)"\s*:\s*$/);
    if (soChave) {
      pendente = soChave[1];
      continue;
    }
    if (pendente) {
      const valor = extrairValor(linha);
      if (valor !== null) dicionarios.get(atual)!.set(pendente, valor);
      pendente = null;
      continue;
    }
    const par = linha.match(/^\s*"([a-zA-Z0-9_.]+)"\s*:\s*(.+)$/);
    if (par) {
      const valor = extrairValor(par[2]);
      if (valor !== null) dicionarios.get(atual)!.set(par[1], valor);
    }
  }
  return dicionarios;
}

/** Lê um literal de string em aspas duplas ou simples, com escapes. */
function extrairValor(trecho: string): string | null {
  const t = trecho.trim();
  const m = t.match(/^"((?:[^"\\]|\\.)*)"|^'((?:[^'\\]|\\.)*)'/);
  if (!m) return null;
  return (m[1] ?? m[2]).replace(/\\"/g, '"').replace(/\\'/g, "'");
}

const placeholders = (valor: string): Set<string> =>
  new Set([...valor.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

const dicionarios = extrairDicionarios(fonte);
if (!dicionarios.has("en")) {
  console.error("Não achei o dicionário 'en' — ele é a referência de comparação.");
  process.exit(1);
}

const en = dicionarios.get("en")!;
const outros = [...dicionarios.keys()].filter((k) => k !== "en");

console.log(`Referência: en (${en.size} chaves)`);
console.log(`Idiomas conferidos: ${outros.join(", ") || "(nenhum)"}\n`);

let problemas = 0;

for (const idioma of outros) {
  const dic = dicionarios.get(idioma)!;
  const faltando = [...en.keys()].filter((k) => !dic.has(k));
  const sobrando = [...dic.keys()].filter((k) => !en.has(k));
  const phRuim: string[] = [];
  const vazias: string[] = [];
  const naoTraduzidas: string[] = [];

  for (const [chave, valorEn] of en) {
    const valor = dic.get(chave);
    if (valor === undefined) continue;
    if (!valor.trim()) vazias.push(chave);

    const esperado = placeholders(valorEn);
    const obtido = placeholders(valor);
    const iguais = esperado.size === obtido.size && [...esperado].every((p) => obtido.has(p));
    if (!iguais) {
      phRuim.push(
        `${chave}\n         en usa {${[...esperado].join("}, {") || ""}}` +
          `\n         ${idioma} usa {${[...obtido].join("}, {") || ""}}`
      );
    }
    // Só vale como aviso: nome próprio e termo técnico ficam iguais mesmo.
    if (valor === valorEn && valorEn.length > 25) naoTraduzidas.push(chave);
  }

  const erros = faltando.length + sobrando.length + phRuim.length + vazias.length;
  problemas += erros;

  console.log(`── ${idioma}: ${dic.size} chaves ${erros ? `— ${erros} problema(s)` : "— ok"}`);

  if (faltando.length) {
    console.log(`   FALTANDO (${faltando.length}) — a interface mostra a chave crua:`);
    for (const k of faltando) console.log(`      ${k}`);
  }
  if (sobrando.length) {
    console.log(`   NÃO EXISTE EM en (${sobrando.length}) — tradução que nunca é usada:`);
    for (const k of sobrando) console.log(`      ${k}`);
  }
  if (vazias.length) {
    console.log(`   VAZIAS (${vazias.length}):`);
    for (const k of vazias) console.log(`      ${k}`);
  }
  if (phRuim.length) {
    console.log(`   PLACEHOLDER TROCADO (${phRuim.length}) — aparece literal na tela:`);
    for (const p of phRuim) console.log(`      ${p}`);
  }
  if (naoTraduzidas.length) {
    console.log(`   (aviso) idêntico ao inglês, confira se é proposital: ${naoTraduzidas.length}`);
    for (const k of naoTraduzidas.slice(0, 5)) console.log(`      ${k}`);
    if (naoTraduzidas.length > 5) console.log(`      ... e mais ${naoTraduzidas.length - 5}`);
  }
  console.log("");
}

// O Lang precisa listar todo idioma registrado, senão ele existe e não é alcançável.
const langDeclarado = fonte.match(/export type Lang\s*=\s*([^;]+);/);
if (langDeclarado) {
  const codigos = [...langDeclarado[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const registrados = [...(fonte.match(/DICTIONARIES[^=]*=\s*\{([^}]*)\}/s)?.[1] ?? "").matchAll(
    /"?([\w-]+)"?\s*:/g
  )].map((m) => m[1]);
  const foraDoLang = registrados.filter((r) => !codigos.includes(r));
  if (foraDoLang.length) {
    problemas += foraDoLang.length;
    console.log(`── Lang: registrado em DICTIONARIES mas ausente do type Lang: ${foraDoLang.join(", ")}\n`);
  } else {
    console.log(`── Lang: ${codigos.join(", ")} — ok\n`);
  }
}

if (problemas) {
  console.log(`${problemas} problema(s) no total.`);
  process.exitCode = 1;
} else {
  console.log("Nenhum problema encontrado.");
}
