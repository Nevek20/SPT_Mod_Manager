export type Lang = "pt-BR" | "en";

type Dict = Record<string, string>;

/**
 * Textos estáticos da UI (botões, rótulos, cabeçalhos, tooltips, placeholders).
 * Chave em dot-notation por seção, pra facilitar achar/organizar.
 * Use {var} dentro do texto pra interpolar valores via t(key, { var: valor }).
 */
const pt: Dict = {
  "toast.instanceConfigured": "Instância configurada.",
  "toast.folderSelectFailed": "Não foi possível selecionar a pasta.",
  "toast.dropInvalidFile": "Solte um arquivo .zip, .7z ou .rar pra instalar.",
  "toast.confirmRemove": 'Remover "{name}" permanentemente?',
  "toast.selectUpdatedFile": "Selecione o arquivo atualizado do mod (.zip / .7z / .rar)...",
  "toast.noConflictsFound": "Nenhum conflito óbvio encontrado.",
  "toast.conflictsFound": "{count} possível(is) conflito(s) encontrado(s).",
  "toast.enterSptVersion": "Informe a versão do SPT antes de verificar.",
  "toast.forgeUpdateCheckFailed": "Falha ao verificar atualizações.",
  "toast.forgeAllUpToDate": "Tudo atualizado (ou não encontrado no Forge).",
  "toast.forgeUpdatesAvailable": "{count} atualização(ões) disponível(is).",
  "toast.forgeSearchFailed": "Falha ao buscar mods na Forge.",
  "toast.confirmRemoveBulk": "Remover {count} mod(s) permanentemente?",
  "toast.bulkProcessed": "{done}/{total} mod(s) processado(s).",

  "empty.selectFolder": "Selecione a pasta da sua instância SPT pra começar.",
  "empty.selectFolderButton": "Selecionar pasta da instância",
  "empty.downloadModsButton": "Baixar mods (hub.sp-tarkov.com)",
  "dropOverlay.text": "Solte o(s) arquivo(s) .zip / .7z / .rar aqui pra instalar",

  "header.browseForge": "Buscar mods (Forge)",
  "header.browseForgeTitle": "Buscar e instalar mods direto do catálogo da Forge",
  "header.openHub": "Baixar mods",
  "header.openHubTitle": "Abrir hub.sp-tarkov.com no navegador",
  "header.changeInstance": "Trocar instância",
  "header.changeInstanceTitle": "Selecionar outra instância SPT",
  "header.installButton": "Instalar mod (.zip / .7z / .rar)",
  "header.installButtonTitle": "Escolher um .zip, .7z ou .rar pra instalar",
  "header.installing": "Instalando...",
  "header.splitInstance": "Client: {client}  •  Server: {server}",

  "summary.total": "mod(s) instalado(s)",
  "summary.active": "Ativos:",
  "summary.disabled": "Desativados:",
  "summary.versionTooltip":
    "Lido de SPT_Data/Server/configs/core.json — a partir do SPT 4.0 esse arquivo só guarda a versão do Tarkov compatível, não a versão do SPT em si",
  "summary.validInstance": "Instância válida",
  "summary.validInstanceTitle": "A pasta selecionada passou na validação de instância SPT",

  "filters.searchPlaceholder": "Pesquisar mod pelo nome...",
  "filters.typeFilterTitle": "Filtrar por tipo",
  "filters.typeAll": "Todos os tipos",
  "filters.statusFilterTitle": "Filtrar por status",
  "filters.statusAll": "Ativos e desativados",
  "filters.statusEnabled": "Só ativos",
  "filters.statusDisabled": "Só desativados",
  "filters.originFilterTitle": "Filtrar por origem",
  "filters.originAll": "Qualquer origem",
  "filters.originManual": "Instalados manualmente",
  "filters.originManager": "Instalados pelo Manager",
  "filters.sortFieldTitle": "Ordenar por",
  "filters.sortByName": "Ordenar por Nome",
  "filters.sortByType": "Ordenar por Tipo",
  "filters.sortByStatus": "Ordenar por Status",
  "filters.sortByOrigin": "Ordenar por Origem",
  "filters.sortByInstalledAt": "Ordenar por Data de instalação",
  "filters.sortDirectionTitle": "Inverter direção da ordenação",
  "filters.sortAsc": "↑ Crescente",
  "filters.sortDesc": "↓ Decrescente",
  "filters.selectAllVisible": "Selecionar todos (visíveis)",
  "filters.selectAllVisibleTitle": "Selecionar todos os mods visíveis com os filtros atuais",
  "filters.clearSelection": "Limpar seleção",
  "filters.exportList": "Exportar lista",
  "filters.exportListTitle": "Salvar a lista atual de mods num arquivo JSON",
  "filters.importCompare": "Importar / Comparar",
  "filters.importCompareTitle": "Comparar a instância atual com uma lista exportada antes",
  "filters.checkConflicts": "Verificar conflitos",
  "filters.checkingConflicts": "Verificando...",
  "filters.checkConflictsTitle": "Procura DLLs duplicadas entre client mods e nomes duplicados entre server mods",
  "filters.sptVersionTitle": "Versão do SPT usada na checagem de atualizações da Forge — a lista vem direto da Forge",
  "filters.sptVersionPlaceholder": "selecione a versão do SPT...",
  "filters.sptVersionNotListed": "(não listada na Forge)",
  "filters.forgeCheckTitle": "Consulta a API pública da Forge (forge.sp-tarkov.com) por atualizações dos mods instalados",
  "filters.forgeChecking": "Consultando Forge...",
  "filters.forgeCheckButton": "Verificar atualizações (Forge)",

  "hint.forgeLastChecked": "Última verificação da Forge: {date}",
  "hint.sortOrderNote":
    "A ordem de carregamento (▲▼) sempre segue o load order real — ordenar por outro campo só muda a exibição.",

  "compare.title": "Comparação com a lista importada",
  "compare.identical": "As duas listas são idênticas.",
  "compare.missing": "Faltando aqui ({count}):",
  "compare.extra": "A mais aqui, fora da lista importada ({count}):",
  "compare.note":
    "Isso é só uma comparação — o app não guarda os arquivos originais dos mods, então reinstalar os que estão faltando precisa ser feito manualmente.",

  "conflicts.title": "Verificação de conflitos",
  "conflicts.appearsIn": "aparece em:",
  "conflicts.nameLabel": "Nome",
  "conflicts.declaredInMultiple": "declarado em mais de uma pasta:",
  "conflicts.note": "Checagem no nível de arquivo — sinaliza sobreposição, não garante incompatibilidade de verdade.",

  "forge.checkTitle": "Verificação de atualizações (Forge)",
  "forge.updatesAvailable": "Atualizações disponíveis:",
  "forge.blockedTitle": "Atualizações bloqueadas (quebrariam dependência):",
  "forge.incompatibleTitle": "Incompatíveis com essa versão do SPT:",
  "forge.infoOnlyTitle": "Sem versão local pra comparar (mostrando o que a Forge tem):",
  "forge.infoHasVersion": "Forge tem v{version}",
  "forge.allUpToDateDetailed": "Todos os mods identificados no Forge estão atualizados.",
  "forge.unmatchedPrefix": "Não encontrados no Forge (busca por nome):",
  "forge.matchNote":
    "Casamento com o catálogo da Forge é por nome — pode não achar mods com nome muito genérico ou que não estão listados lá.",

  "bulk.selectedCount": "{count} selecionado(s)",
  "bulk.enable": "Habilitar",
  "bulk.disable": "Desabilitar",
  "bulk.remove": "Remover",
  "bulk.cancelSelection": "Cancelar seleção",

  "noResults.text": "Nenhum mod bate com os filtros/busca atuais.",
  "noResults.clearFilters": "Limpar filtros",

  "common.close": "Fechar",
  "common.link": "link",

  "browse.title": "Buscar mods no Forge",
  "browse.searchPlaceholder": "Pesquisar por nome, slug ou descrição...",
  "browse.categoryFilterTitle": "Filtrar por categoria",
  "browse.allCategories": "Todas as categorias",
  "browse.compatibleOnlyTitle": "Usa a versão do SPT selecionada nos filtros principais",
  "browse.compatibleOnlyLabel": "Só compatíveis com {version}",
  "browse.selectVersionPlaceholder": "(selecione a versão do SPT)",
  "browse.searching": "Buscando...",
  "browse.searchButton": "Buscar",
  "browse.noResults": "Nenhum mod encontrado com esses filtros.",
  "browse.viewOnForgeTitle": "Ver no Forge (abre no navegador)",
  "browse.fikaCompatibleTitle": "Tem versão compatível com Fika",
  "browse.byAuthor": "por {author}",
  "browse.downloadsLabel": "downloads",
  "browse.chooseVersionTitle": "Escolher a versão a instalar",
  "browse.installing": "Instalando...",
  "browse.installButton": "Instalar",
  "browse.noVersionPublished": '"{name}" não tem nenhuma versão publicada pra instalar.',
  "browse.noVersionPublishedShort": "Sem versão publicada",
  "browse.prevPage": "← Anterior",
  "browse.pageOf": "Página {page} de {lastPage}",
  "browse.nextPage": "Próxima →",
  "browse.installNote":
    'A instalação baixa o arquivo direto da Forge e usa o mesmo instalador do botão "Instalar mod" — inclusive a detecção de client/server mod e o registro no Manager.',

  "confirm.title": "Estrutura de arquivo incomum",
  "confirm.descriptionPrefix": "Não encontrei nenhuma DLL,",
  "confirm.descriptionMid": "ou pasta",
  "confirm.descriptionSuffix":
    "reconhecível nesse arquivo. Isso pode ser um mod empacotado de um jeito diferente do normal, ou o arquivo errado. Isto é o que tem na raiz do arquivo:",
  "confirm.emptyArchive": "(arquivo vazio)",
  "confirm.explanation":
    'Se você reconhece isso como um mod válido, "Continuar" copia tudo que está listado acima direto pra raiz da sua instância SPT (do mesmo jeito que os mods reconhecidos automaticamente), e registra como um item que dá pra remover depois. Se você não reconhece, é mais seguro abortar.',
  "confirm.abort": "Abortar",
  "confirm.proceed": "Continuar mesmo assim",

  "modlist.emptyCategory": "Nenhum mod nessa categoria.",
  "modlist.checkboxTitle": "Clique para selecionar, Shift+Clique para selecionar um intervalo",
  "modlist.moveUpTitle": "Mover pra cima",
  "modlist.moveDownTitle": "Mover pra baixo",
  "modlist.renameTitle": "{name} (duplo-clique pra renomear)",
  "modlist.statusActive": "Ativo",
  "modlist.statusDisabled": "Desativado",
  "modlist.forgeUpdateAvailableTitle": "Nova versão disponível na Forge",
  "modlist.forgeUpdateAvailable": "Forge: v{version} disponível",
  "modlist.forgeBlockedTitle": "Tem atualização na Forge, mas instalar quebraria a dependência de outro mod",
  "modlist.forgeBlocked": "Forge: atualização bloqueada",
  "modlist.forgeIncompatibleTitle":
    "A versão instalada não é compatível com a versão do SPT informada na última checagem",
  "modlist.forgeIncompatible": "Forge: incompatível",
  "modlist.forgeInfoTitle":
    "Sem versão local legível pra comparar (mod sem package.json, ex: mods .dll) — essa é a versão mais recente conhecida na Forge",
  "modlist.forgeInfo": "Forge: v{version}",
  "modlist.orphanTitle": "Arquivos soltos rastreados por manifesto (sem pasta própria) — só dá pra remover",
  "modlist.orphan": "Órfão",
  "modlist.actionsTitle": "Ações",
  "modlist.openFolder": "Abrir pasta",
  "modlist.rename": "Renomear",
  "modlist.reinstall": "Reinstalar"
};

const en: Dict = {
  "toast.instanceConfigured": "Instance configured.",
  "toast.folderSelectFailed": "Couldn't select the folder.",
  "toast.dropInvalidFile": "Drop a .zip, .7z, or .rar file to install.",
  "toast.confirmRemove": 'Permanently remove "{name}"?',
  "toast.selectUpdatedFile": "Select the mod's updated file (.zip / .7z / .rar)...",
  "toast.noConflictsFound": "No obvious conflicts found.",
  "toast.conflictsFound": "{count} possible conflict(s) found.",
  "toast.enterSptVersion": "Enter the SPT version before checking.",
  "toast.forgeUpdateCheckFailed": "Failed to check for updates.",
  "toast.forgeAllUpToDate": "Everything up to date (or not found on Forge).",
  "toast.forgeUpdatesAvailable": "{count} update(s) available.",
  "toast.forgeSearchFailed": "Failed to search mods on Forge.",
  "toast.confirmRemoveBulk": "Permanently remove {count} mod(s)?",
  "toast.bulkProcessed": "{done}/{total} mod(s) processed.",

  "empty.selectFolder": "Select your SPT instance folder to get started.",
  "empty.selectFolderButton": "Select instance folder",
  "empty.downloadModsButton": "Download mods (hub.sp-tarkov.com)",
  "dropOverlay.text": "Drop the .zip / .7z / .rar file(s) here to install",

  "header.browseForge": "Browse mods (Forge)",
  "header.browseForgeTitle": "Search and install mods straight from Forge's catalogue",
  "header.openHub": "Download mods",
  "header.openHubTitle": "Open hub.sp-tarkov.com in the browser",
  "header.changeInstance": "Change instance",
  "header.changeInstanceTitle": "Select a different SPT instance",
  "header.installButton": "Install mod (.zip / .7z / .rar)",
  "header.installButtonTitle": "Choose a .zip, .7z, or .rar to install",
  "header.installing": "Installing...",
  "header.splitInstance": "Client: {client}  •  Server: {server}",

  "summary.total": "mod(s) installed",
  "summary.active": "Active:",
  "summary.disabled": "Disabled:",
  "summary.versionTooltip":
    "Read from SPT_Data/Server/configs/core.json — starting with SPT 4.0 this file only stores the compatible Tarkov version, not the SPT version itself",
  "summary.validInstance": "Valid instance",
  "summary.validInstanceTitle": "The selected folder passed SPT instance validation",

  "filters.searchPlaceholder": "Search mod by name...",
  "filters.typeFilterTitle": "Filter by type",
  "filters.typeAll": "All types",
  "filters.statusFilterTitle": "Filter by status",
  "filters.statusAll": "Active and disabled",
  "filters.statusEnabled": "Active only",
  "filters.statusDisabled": "Disabled only",
  "filters.originFilterTitle": "Filter by origin",
  "filters.originAll": "Any origin",
  "filters.originManual": "Installed manually",
  "filters.originManager": "Installed by the Manager",
  "filters.sortFieldTitle": "Sort by",
  "filters.sortByName": "Sort by Name",
  "filters.sortByType": "Sort by Type",
  "filters.sortByStatus": "Sort by Status",
  "filters.sortByOrigin": "Sort by Origin",
  "filters.sortByInstalledAt": "Sort by Install date",
  "filters.sortDirectionTitle": "Reverse sort direction",
  "filters.sortAsc": "↑ Ascending",
  "filters.sortDesc": "↓ Descending",
  "filters.selectAllVisible": "Select all (visible)",
  "filters.selectAllVisibleTitle": "Select every mod visible with the current filters",
  "filters.clearSelection": "Clear selection",
  "filters.exportList": "Export list",
  "filters.exportListTitle": "Save the current mod list to a JSON file",
  "filters.importCompare": "Import / Compare",
  "filters.importCompareTitle": "Compare the current instance against a previously exported list",
  "filters.checkConflicts": "Check conflicts",
  "filters.checkingConflicts": "Checking...",
  "filters.checkConflictsTitle":
    "Looks for duplicate DLLs between client mods and duplicate names between server mods",
  "filters.sptVersionTitle": "SPT version used when checking for Forge updates — the list comes straight from Forge",
  "filters.sptVersionPlaceholder": "select the SPT version...",
  "filters.sptVersionNotListed": "(not listed on Forge)",
  "filters.forgeCheckTitle": "Queries Forge's public API (forge.sp-tarkov.com) for updates to installed mods",
  "filters.forgeChecking": "Checking Forge...",
  "filters.forgeCheckButton": "Check for updates (Forge)",

  "hint.forgeLastChecked": "Last checked on Forge: {date}",
  "hint.sortOrderNote":
    "Load order (▲▼) always follows the real load order — sorting by another field only changes the display.",

  "compare.title": "Comparison with imported list",
  "compare.identical": "Both lists are identical.",
  "compare.missing": "Missing here ({count}):",
  "compare.extra": "Extra here, not in the imported list ({count}):",
  "compare.note":
    "This is just a comparison — the app doesn't keep the mods' original files, so reinstalling the missing ones has to be done manually.",

  "conflicts.title": "Conflict check",
  "conflicts.appearsIn": "appears in:",
  "conflicts.nameLabel": "Name",
  "conflicts.declaredInMultiple": "declared in more than one folder:",
  "conflicts.note": "File-level check — it flags overlap, it doesn't guarantee an actual incompatibility.",

  "forge.checkTitle": "Update check (Forge)",
  "forge.updatesAvailable": "Updates available:",
  "forge.blockedTitle": "Blocked updates (would break a dependency):",
  "forge.incompatibleTitle": "Incompatible with this SPT version:",
  "forge.infoOnlyTitle": "No local version to compare (showing what Forge has):",
  "forge.infoHasVersion": "Forge has v{version}",
  "forge.allUpToDateDetailed": "Every mod identified on Forge is up to date.",
  "forge.unmatchedPrefix": "Not found on Forge (matched by name):",
  "forge.matchNote":
    "Matching against Forge's catalogue is done by name — it may not find mods with a very generic name, or ones not listed there.",

  "bulk.selectedCount": "{count} selected",
  "bulk.enable": "Enable",
  "bulk.disable": "Disable",
  "bulk.remove": "Remove",
  "bulk.cancelSelection": "Cancel selection",

  "noResults.text": "No mod matches the current filters/search.",
  "noResults.clearFilters": "Clear filters",

  "common.close": "Close",
  "common.link": "link",

  "browse.title": "Search Forge mods",
  "browse.searchPlaceholder": "Search by name, slug, or description...",
  "browse.categoryFilterTitle": "Filter by category",
  "browse.allCategories": "All categories",
  "browse.compatibleOnlyTitle": "Uses the SPT version selected in the main filters",
  "browse.compatibleOnlyLabel": "Only compatible with {version}",
  "browse.selectVersionPlaceholder": "(select the SPT version)",
  "browse.searching": "Searching...",
  "browse.searchButton": "Search",
  "browse.noResults": "No mods found with these filters.",
  "browse.viewOnForgeTitle": "View on Forge (opens in browser)",
  "browse.fikaCompatibleTitle": "Has a Fika-compatible version",
  "browse.byAuthor": "by {author}",
  "browse.downloadsLabel": "downloads",
  "browse.chooseVersionTitle": "Choose the version to install",
  "browse.installing": "Installing...",
  "browse.installButton": "Install",
  "browse.noVersionPublished": '"{name}" has no published version to install.',
  "browse.noVersionPublishedShort": "No version published",
  "browse.prevPage": "← Previous",
  "browse.pageOf": "Page {page} of {lastPage}",
  "browse.nextPage": "Next →",
  "browse.installNote":
    'Installing downloads the file straight from Forge and runs it through the same installer as the "Install mod" button — including client/server mod detection and registering it with the Manager.',

  "confirm.title": "Unusual file structure",
  "confirm.descriptionPrefix": "I couldn't find any DLL,",
  "confirm.descriptionMid": "or a",
  "confirm.descriptionSuffix":
    "folder in this file. This could be a mod packaged in an unusual way, or the wrong file. Here's what's in the root of the file:",
  "confirm.emptyArchive": "(empty archive)",
  "confirm.explanation":
    'If you recognize this as a valid mod, "Continue anyway" copies everything listed above straight into your SPT instance root (the same way auto-detected mods are installed), and registers it as an item you can remove later. If you don\'t recognize it, aborting is safer.',
  "confirm.abort": "Abort",
  "confirm.proceed": "Continue anyway",

  "modlist.emptyCategory": "No mods in this category.",
  "modlist.checkboxTitle": "Click to select, Shift+Click to select a range",
  "modlist.moveUpTitle": "Move up",
  "modlist.moveDownTitle": "Move down",
  "modlist.renameTitle": "{name} (double-click to rename)",
  "modlist.statusActive": "Active",
  "modlist.statusDisabled": "Disabled",
  "modlist.forgeUpdateAvailableTitle": "New version available on Forge",
  "modlist.forgeUpdateAvailable": "Forge: v{version} available",
  "modlist.forgeBlockedTitle": "Has an update on Forge, but installing it would break another mod's dependency",
  "modlist.forgeBlocked": "Forge: update blocked",
  "modlist.forgeIncompatibleTitle":
    "The installed version isn't compatible with the SPT version entered in the last check",
  "modlist.forgeIncompatible": "Forge: incompatible",
  "modlist.forgeInfoTitle":
    "No readable local version to compare (mod without package.json, e.g. .dll-only mods) — this is the latest version known on Forge",
  "modlist.forgeInfo": "Forge: v{version}",
  "modlist.orphanTitle": "Loose files tracked by manifest (no folder of its own) — can only be removed",
  "modlist.orphan": "Orphan",
  "modlist.actionsTitle": "Actions",
  "modlist.openFolder": "Open folder",
  "modlist.rename": "Rename",
  "modlist.reinstall": "Reinstall"
};

export const DICTIONARIES: Record<Lang, Dict> = { "pt-BR": pt, en };

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let str = DICTIONARIES[lang][key] ?? DICTIONARIES["pt-BR"][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

/**
 * O backend (processo main / modManager.ts) sempre responde em português —
 * ele não sabe em qual idioma a UI está. Em vez de reescrever todas as ~50
 * mensagens do backend pra retornar códigos (grande refatoração, mais risco
 * de reintroduzir bug nas partes que acabamos de corrigir), a gente traduz
 * aqui na hora de exibir, casando contra o conjunto conhecido de mensagens.
 * Se uma mensagem nova não bater com nenhuma regra, mostra o texto original
 * (em português) em vez de quebrar — é um degrade aceitável.
 */
interface BackendMessageRule {
  pattern: RegExp;
  en: (m: RegExpMatchArray) => string;
}

const BACKEND_MESSAGE_RULES: BackendMessageRule[] = [
  // --- Mensagens fixas (sem parte dinâmica) ---
  { pattern: /^Nenhuma instância SPT configurada\.$/, en: () => "No SPT instance configured." },
  { pattern: /^Cancelado\.$/, en: () => "Cancelled." },
  { pattern: /^Pasta aberta\.$/, en: () => "Folder opened." },
  { pattern: /^Nome restaurado pro original\.$/, en: () => "Name restored to original." },
  { pattern: /^Nome atualizado\.$/, en: () => "Name updated." },
  {
    pattern: /^Estrutura de arquivo incomum: não encontrei DLL, package\.json nem pasta user\/BepInEx\.$/,
    en: () => "Unusual file structure: found no DLL, package.json, or user/BepInEx folder."
  },
  { pattern: /^Mod instalado e verificado \(estrutura completa detectada\)\.$/, en: () => "Mod installed and verified (full structure detected)." },
  { pattern: /^Caminho temporário inválido\.$/, en: () => "Invalid temporary path." },
  {
    pattern: /^A extração temporária não existe mais — tente instalar o arquivo de novo\.$/,
    en: () => "The temporary extraction no longer exists — try installing the file again."
  },
  { pattern: /^Instalação cancelada\.$/, en: () => "Installation cancelled." },
  {
    pattern: /^Esse item é um arquivo do próprio SPT \(não é um mod\) e não pode ser alternado\.$/,
    en: () => "This item is one of SPT's own files (not a mod) and can't be toggled."
  },
  {
    pattern: /^Esse item é um arquivo do próprio SPT \(não é um mod\) e não pode ser removido pelo Manager\.$/,
    en: () => "This item is one of SPT's own files (not a mod) and can't be removed by the Manager."
  },
  { pattern: /^Mod desabilitado\.$/, en: () => "Mod disabled." },
  { pattern: /^Mod habilitado\.$/, en: () => "Mod enabled." },
  { pattern: /^Entrada removida da lista \(nenhum arquivo rastreado\)\.$/, en: () => "Entry removed from the list (no tracked files)." },
  { pattern: /^Mod removido\.$/, en: () => "Mod removed." },
  { pattern: /^Pasta de server mods não existe\.$/, en: () => "Server mods folder doesn't exist." },
  { pattern: /^Ordem de carregamento atualizada\.$/, en: () => "Load order updated." },
  { pattern: /^Falha ao verificar atualizações\.$/, en: () => "Failed to check for updates." },
  { pattern: /^Falha ao buscar mods na Forge\.$/, en: () => "Failed to search mods on Forge." },
  {
    pattern: /^Esse arquivo não parece uma lista de mods exportada por este app\.$/,
    en: () => "This file doesn't look like a mod list exported by this app."
  },
  {
    pattern: /^Não achei uma instância SPT nessa pasta nem nas subpastas diretas dela\. Selecione a pasta que tem o SPT\.Server\.exe\.$/,
    en: () => "Couldn't find an SPT instance in that folder or its direct subfolders. Select the folder that has SPT.Server.exe."
  },
  { pattern: /^Informe a versão do SPT antes de verificar atualizações\.$/, en: () => "Enter the SPT version before checking for updates." },

  // --- Mensagens com parte dinâmica (nome de arquivo, contagem, erro etc.) ---
  {
    pattern: /^Instalação incompleta: arquivo não confirmado no destino \((.+)\)\.$/,
    en: (m) => `Incomplete installation: file not confirmed at destination (${m[1]}).`
  },
  {
    pattern: /^Mod "(.+)" instalado e verificado como (server mod|client mod)\.$/,
    en: (m) => `Mod "${m[1]}" installed and verified as a ${m[2] === "server mod" ? "server mod" : "client mod"}.`
  },
  { pattern: /^Erro ao instalar: (.+)$/, en: (m) => `Error installing: ${m[1]}` },
  { pattern: /^(\d+) arquivo\(s\) órfão\(s\) removido\(s\)\.$/, en: (m) => `${m[1]} orphan file(s) removed.` },
  { pattern: /^Arquivo\/pasta do mod não encontrado: (.+)$/, en: (m) => `Mod file/folder not found: ${m[1]}` },
  { pattern: /^Mod não encontrado: (.+)$/, en: (m) => `Mod not found: ${m[1]}` },
  { pattern: /^Não foi possível baixar o mod da Forge \(HTTP (\d+)\)\.$/, en: (m) => `Couldn't download the mod from Forge (HTTP ${m[1]}).` },
  { pattern: /^Falha ao baixar\/instalar da Forge: (.+)$/, en: (m) => `Failed to download/install from Forge: ${m[1]}` },
  { pattern: /^Instância encontrada automaticamente em: (.+)$/, en: (m) => `Instance automatically found at: ${m[1]}` },
  {
    pattern: /^Instância dividida detectada — client em "(.+)", server em "(.+)"\.$/,
    en: (m) => `Split instance detected — client at "${m[1]}", server at "${m[2]}".`
  },
  { pattern: /^Arquivo "(.+)" não é \.zip, \.7z nem \.rar\.$/, en: (m) => `File "${m[1]}" isn't .zip, .7z, or .rar.` },
  { pattern: /^Caminho do mod não encontrado: (.+)$/, en: (m) => `Mod path not found: ${m[1]}` },
  { pattern: /^Lista exportada com (\d+) mod\(s\) para (.+)\.$/, en: (m) => `List exported with ${m[1]} mod(s) to ${m[2]}.` },
  { pattern: /^Comparado com (\d+) mod\(s\) da lista importada\.$/, en: (m) => `Compared against ${m[1]} mod(s) from the imported list.` },
  { pattern: /^Erro ao ler o arquivo: (.+)$/, en: (m) => `Error reading the file: ${m[1]}` },
  { pattern: /^Não foi possível consultar o Forge: (.+)$/, en: (m) => `Couldn't reach Forge: ${m[1]}` },
  { pattern: /^Forge respondeu (\d+)$/, en: (m) => `Forge responded ${m[1]}` }
];

export function translateBackendMessage(msg: string | undefined | null, lang: Lang): string {
  if (!msg) return msg ?? "";
  if (lang === "pt-BR") return msg;
  for (const rule of BACKEND_MESSAGE_RULES) {
    const match = msg.match(rule.pattern);
    if (match) return rule.en(match);
  }
  return msg; // sem regra — melhor mostrar em PT do que quebrar a mensagem
}