/**
 * Idioma das mensagens do backend e o relato de erro.
 *
 * Issue #6: um usuário em inglês recebeu "Couldn't reach Forge: sp-mod.com
 * (oficial) respondeu 414 URI Too Long em vez de JSON". O backend falava
 * português e uma regra traduzia cada frase conhecida; a do lerJson nunca ganhou
 * regra, e vazou em PT. Agora o backend fala inglês e as regras só traduzem pro
 * português. Mensagem sem regra cai em inglês, que qualquer um lê.
 *
 * O primeiro bloco é uma trava: se alguém escrever mensagem nova em português no
 * backend, este teste quebra antes de chegar num usuário.
 */

import fs from "fs";
import path from "path";
import ts from "typescript";
import { translateBackendMessage } from "../src/i18n";
import { apagaHome, montaRelato, urlIssueGithub } from "../src/relatoErro";

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

// ---------------------------------------------------------------------------
console.log("\ntrava: o backend nao fala portugues");
// ---------------------------------------------------------------------------
{
  const PT = /[ãõçéêóôíúáâà]|\b(não|nenhum|nenhuma|pasta|arquivo|caminho|esse|falha|erro|respondeu|pra|partes|habilitado|desabilitado|removido|atualizado|instalado|encontrado|versão)\b/i;
  const achados: string[] = [];
  const arquivos = ["main.ts", "modManager.ts", "sources.ts", "preload.ts", "peVersion.ts"];
  for (const nome of arquivos) {
    const caminho = path.join("electron", nome);
    const src = fs.readFileSync(caminho, "utf8");
    const sf = ts.createSourceFile(caminho, src, ts.ScriptTarget.Latest, true);
    const visita = (n: ts.Node) => {
      let texto: string | null = null;
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) texto = n.text;
      else if (ts.isTemplateExpression(n)) texto = n.getText();
      if (texto !== null && PT.test(texto)) {
        // console.* é diagnóstico do desenvolvedor, não chega no usuário.
        let p: ts.Node | undefined = n.parent;
        let ehLog = false;
        while (p) {
          if (ts.isCallExpression(p) && /^console\./.test(p.expression.getText())) ehLog = true;
          p = p.parent;
        }
        if (!ehLog) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart());
          achados.push(`${caminho}:${line + 1} ${texto.slice(0, 60)}`);
        }
      }
      ts.forEachChild(n, visita);
    };
    visita(sf);
  }
  if (achados.length) console.log("    " + achados.join("\n    "));
  check("nenhum texto em portugues nas strings do backend", achados.length, 0);
}

// ---------------------------------------------------------------------------
console.log("\npt-BR traduz as mensagens comuns");
// ---------------------------------------------------------------------------
const casos: [string, string][] = [
  ["No SPT instance configured.", "Nenhuma instância SPT configurada."],
  ["Cancelled.", "Cancelado."],
  ["Mod removed.", "Mod removido."],
  ["Mod removed (2 package parts).", "Mod removido (2 partes do pacote)."],
  ["Mod disabled (along with 1 patcher(s)).", "Mod desabilitado (e 1 patcher(s) junto)."],
  ["Mod updated (3 folder(s) from the previous version removed).", "Mod atualizado (3 pasta(s) da versão anterior removida(s))."],
  ['Mod "SAIN" installed and verified as a server mod.', 'Mod "SAIN" instalado e verificado como server mod.'],
  ['File "x.exe" isn\'t .zip, .7z, or .rar.', 'Arquivo "x.exe" não é .zip, .7z nem .rar.'],
  ["Unsupported archive format: .tar. Use .zip, .7z, or .rar.", "Formato de arquivo não suportado: .tar. Use .zip, .7z ou .rar."],
  ["sp-mod.com (official) didn't respond.", "sp-mod.com (official) não respondeu."],
  [
    'File rejected for security reasons: suspicious entry in the .7z ("../../evil.dll").',
    'Arquivo rejeitado por segurança: entrada suspeita no .7z ("../../evil.dll").'
  ],
  [
    'Split instance detected: client at "C:\\A", server at "C:\\B".',
    'Instância dividida detectada: client em "C:\\A", server em "C:\\B".'
  ],
  // Aninhada: o prefixo traduz e o que vem dentro também, quando é conhecido.
  ["Error installing: Invalid temporary path.", "Erro ao instalar: Caminho temporário inválido."]
];
for (const [en, pt] of casos) check(en, translateBackendMessage(en, "pt-BR"), pt);

// ---------------------------------------------------------------------------
console.log("\nos outros idiomas veem o texto do backend");
// ---------------------------------------------------------------------------
for (const lang of ["en", "ru", "zh-CN", "ja", "fr", "de"] as const) {
  check(`${lang} recebe o ingles intacto`, translateBackendMessage("Mod removed.", lang), "Mod removed.");
}

// ---------------------------------------------------------------------------
console.log("\no caso da issue #6");
// ---------------------------------------------------------------------------
{
  const erro =
    "Couldn't check for updates: sp-mod.com (official) responded 414 URI Too Long instead of JSON (text/html). Start of response: <title>414</title>";
  check("em ingles, sai do jeito que o backend mandou", translateBackendMessage(erro, "en"), erro);
  const pt = translateBackendMessage(erro, "pt-BR");
  check("em pt-BR, o prefixo traduz", pt.startsWith("Não foi possível verificar atualizações: "), true);
  check("e o detalhe tecnico fica em ingles", pt.endsWith("responded 414 URI Too Long instead of JSON (text/html). Start of response: <title>414</title>"), true);
  check("mensagem sem regra fica em ingles no pt-BR", translateBackendMessage("Something new happened.", "pt-BR"), "Something new happened.");
}

// ---------------------------------------------------------------------------
console.log("\nrelato de erro");
// ---------------------------------------------------------------------------
{
  const diag = { appVersion: "0.6.4", os: "Windows 10.0.26100 (x64)", homeDir: "C:\\Users\\Guida", reportPage: null };

  check(
    "apaga a pasta do usuario",
    apagaHome("Mod path not found: C:\\Users\\Guida\\Desktop\\SPT\\user\\mods\\X", diag.homeDir),
    "Mod path not found: ~\\Desktop\\SPT\\user\\mods\\X"
  );
  check("com barra normal tambem", apagaHome("C:/Users/Guida/Desktop", diag.homeDir), "~/Desktop");
  check("sem diferenciar maiuscula", apagaHome("c:\\users\\guida\\x", diag.homeDir), "~\\x");
  check("home curta demais nao apaga nada", apagaHome("C:\\jogo", "C:\\"), "C:\\jogo");

  const relato = montaRelato("Mod not found: C:\\Users\\Guida\\x", diag, "4.1.6");
  check("relato tem versao do app, do SPT e sistema na primeira linha", relato.split("\n")[0], "SPT Mod Manager 0.6.4 | SPT 4.1.6 | Windows 10.0.26100 (x64)");
  check("e o erro ja sem o nome de usuario", relato.split("\n")[1], "Mod not found: ~\\x");
  check("SPT desconhecido nao some da linha", montaRelato("x", diag).split("\n")[0].includes("SPT unknown"), true);

  const url = urlIssueGithub("a".repeat(200), relato);
  const u = new URL(url);
  check("aponta pro repositorio certo", u.origin + u.pathname, "https://github.com/Nevek20/SPT_Mod_Manager/issues/new");
  check("titulo cortado em 80", (u.searchParams.get("title") ?? "").length, 80);
  check("corpo leva o relato", (u.searchParams.get("body") ?? "").includes(relato), true);
  // A allowlist do main só abre github.com/Nevek20/SPT_Mod_Manager/...
  check("passa na allowlist do main", /^https:\/\/github\.com\/Nevek20\/SPT_Mod_Manager\//.test(url), true);
}

console.log(`\n${ok} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
