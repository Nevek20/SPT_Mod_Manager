/**
 * Monta o relato de erro que o usuário copia ou manda pro GitHub.
 *
 * Existe porque os relatos chegavam sem o que importa: print cortado no meio
 * (o `</cente` da issue #6), sem versão do app, sem versão do SPT. O relato
 * responde as perguntas que sempre precisavam ser feitas de volta.
 *
 * Separado do App.tsx pra ser testável sem interface.
 */

export interface Diagnostico {
  appVersion: string;
  os: string;
  homeDir: string;
  reportPage: string | null;
}

const REPO_ISSUES = "https://github.com/Nevek20/SPT_Mod_Manager/issues/new";

/**
 * Tira a pasta do usuário do texto. Caminho do Windows traz o nome de usuário
 * (C:\Users\Fulano\...), e isso não precisa ir parar num comentário público.
 * Compara sem diferenciar maiúscula e aceita as duas barras, porque o Node às
 * vezes devolve o mesmo caminho com barra normal.
 */
export function apagaHome(texto: string, homeDir: string): string {
  const home = homeDir.replace(/[\\/]+$/, "");
  if (home.length < 3) return texto; // "/" ou "C:" apagaria o texto inteiro
  const escapa = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const variantes = new Set([home, home.replace(/\\/g, "/"), home.replace(/\//g, "\\")]);
  let saida = texto;
  for (const v of variantes) saida = saida.replace(new RegExp(escapa(v), "gi"), "~");
  return saida;
}

export function montaRelato(raw: string, diag: Diagnostico, sptVersion?: string): string {
  const cabecalho = [`SPT Mod Manager ${diag.appVersion}`, `SPT ${sptVersion || "unknown"}`, diag.os].join(" | ");
  return `${cabecalho}\n${apagaHome(raw.trim(), diag.homeDir)}`;
}

/**
 * Link pra issue nova, já preenchida. O título é a primeira linha do erro
 * (cortada: título gigante vira bagunça na lista de issues) e o corpo é o
 * relato mais uma pergunta, porque "o que você estava fazendo" é a informação
 * que o relato sozinho não tem.
 */
export function urlIssueGithub(raw: string, relato: string): string {
  const primeira = raw.trim().split("\n")[0];
  const titulo = primeira.length > 80 ? primeira.slice(0, 77) + "..." : primeira;
  const corpo = ["```", relato, "```", "", "**What were you doing when this happened?**", "", ""].join("\n");
  return `${REPO_ISSUES}?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;
}
