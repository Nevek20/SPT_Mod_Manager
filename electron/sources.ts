/**
 * Fontes de mods.
 *
 * A Forge original (forge.sp-tarkov.com) saiu do ar em agosto de 2026. Surgiram a
 * continuação oficial (sp-mod.com) e espelhos comunitários, todos falando a mesma
 * API v0. Como não dá pra saber qual vai durar — nem obrigar ninguém a confiar num
 * site específico —, a fonte é escolha do usuário e não constante no código.
 *
 * Os ids numéricos de mod e de versão são os MESMOS entre sp-mod e Forge Alt (foram
 * preservados na importação), mas isso é sorte, não garantia: uma fonte futura pode
 * numerar do próprio jeito. Por isso o cache de casamento guarda id POR FONTE, e
 * nunca um id solto.
 */

export interface ModSource {
  key: string;
  /** Nome mostrado no seletor. */
  label: string;
  apiBase: string;
  /** Site pra abrir no navegador (botão "Baixar mods"). */
  siteUrl: string;
  /** Página do próprio Mod Manager nessa fonte, quando existe. */
  modManagerPage?: string;
}

export const MOD_SOURCES: ModSource[] = [
  {
    key: "sp-mod",
    label: "sp-mod.com (oficial)",
    apiBase: "https://sp-mod.com/api/v0",
    siteUrl: "https://sp-mod.com/",
    modManagerPage: "https://sp-mod.com/mod/2851/spt-mod-manager"
  },
  {
    key: "forge-alt",
    label: "Forge Alt (comunidade)",
    apiBase: "https://forge-alt.katrinfoxvr.com/api/v0",
    siteUrl: "https://forge-alt.katrinfoxvr.com/",
    modManagerPage: "https://forge-alt.katrinfoxvr.com/mods/spt-mod-manager"
  }
];

export const DEFAULT_SOURCE_KEY = "sp-mod";

export function getSourceByKey(key: string | null | undefined): ModSource {
  // Cai no padrão em vez de estourar: uma chave salva pode ter sumido da lista
  // numa atualização, e quebrar o app inteiro por causa disso seria pior do que
  // silenciosamente voltar pra fonte oficial.
  return MOD_SOURCES.find((s) => s.key === key) ?? MOD_SOURCES[0];
}
