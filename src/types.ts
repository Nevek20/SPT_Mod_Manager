export type ModType = "server" | "client" | "hybrid" | "unknown";

/**
 * Dependência de um mod, já resolvida contra o que está instalado.
 * Espelha ModDependencyInfo de electron/modManager.ts — o renderer não importa
 * daquele lado, então os dois precisam ser mantidos em sincronia.
 */
export interface ModDependencyInfo {
  id: number;
  guid: string;
  name: string;
  slug?: string;
  conflict: boolean;
  version?: string;
  downloadLink?: string;
  sizeBytes?: number;
  status: "installed" | "outdated" | "missing" | "unavailable";
  installedVersion?: string;
  installedName?: string;
  depth: number;
  /** Mods já instalados que também exigem esta dependência. */
  usedBy?: string[];
}

export interface ModInfo {
  id: string;
  name: string;
  originalName: string;
  type: ModType;
  enabled: boolean;
  installedManually: boolean;
  loadOrder: number;
  version?: string;
  author?: string;
  installedAt?: string;
  manifestOnly?: boolean;
  sptVersion?: string; // restrição de versão do SPT declarada pelo mod (lida da DLL)
  sptCompatibility?: "compatible" | "incompatible" | "unknown"; // declarada x versão da instância
  packageId?: string; // partes instaladas do mesmo arquivo compartilham esse id
  packageSiblings?: { id: string; type: ModType }[]; // outras partes, quando o pacote é inferido
  guid?: string; // GUID declarado pelo mod (SPT 4.0) — casamento exato com a Forge
  linkedModName?: string;
  forgeName?: string; // nome publicado na Forge, gravado no registro na instalação
  /** Página deste mod na fonte ativa, quando o app conhece o id dele lá. */
  /** Id deste mod na fonte ativa, quando o app o conhece. Abre a página dele. */
  forgeModId?: number;
  /** Vínculo com a página do catálogo escolhido à mão. */
  forgeLinkManual?: boolean;
  /** Versão informada à mão no vínculo. */
  versionManual?: boolean;
}

/** Perfil de mods, como a lista do seletor mostra. */
export interface ModProfileSummary {
  id: string;
  name: string;
  updatedAt: string;
  modCount: number;
  enabledCount: number;
}

export interface ProfileSwitchResult {
  success: boolean;
  message: string;
  /** Mods do perfil que não estão no disco; prontos pra procurar no catálogo. */
  missing: { name: string; guid?: string; version?: string; id?: number }[];
  /** Desativados por não fazerem parte do perfil. */
  disabled: string[];
  failed: string[];
}

/** Categorias que o usuário criou, e em qual delas está cada linha da lista. */
export interface CustomCategories {
  categories: { id: string; name: string }[];
  /** chave da linha na árvore (packageId ou solo:tipo:id) -> id da categoria */
  assign: Record<string, string>;
}

export interface ModSourceInfo {
  key: string;
  label: string;
  siteUrl: string;
}

export interface ModListComparison {
  missing: string[];
  extra: string[];
}

export interface ConflictReport {
  clientFileConflicts: { fileName: string; mods: string[] }[];
  duplicateServerNames: { declaredName: string; mods: string[] }[];
  duplicateClientMods?: { declaredName: string; mods: string[] }[];
}

export interface ForgeUpdateItem {
  name: string;
  currentVersion?: string;
  recommendedVersion?: string;
  downloadLink?: string;
  guid?: string; // identificador da Forge, gravado ao atualizar pelo app
  reason?: string;
  /** Id do mod na fonte, pra abrir a página dele direto na aba de versões. */
  modId?: number;
  /** Só em atualização bloqueada: quem trava e o que aceita. */
  blockingMods?: { name: string; modId?: number; version?: string; constraint?: string }[];
}

export interface DownloadQueueJob {
  id: string;
  name: string;
  state: "queued" | "downloading" | "paused" | "waiting" | "installing";
  received: number;
  total: number;
  /** Bytes por segundo, média recente. */
  speed: number;
  fromCache: boolean;
  /** O servidor não deixou continuar de onde parou: recomeçou do zero. */
  restarted: boolean;
}

export const MAX_DOWNLOADS_OPTIONS = [1, 2, 3] as const;

export interface DownloadCacheInfo {
  /** Limite escolhido, em GB. 0 = desligado. */
  limitGB: number;
  usedBytes: number;
  count: number;
}

/** Opções do seletor (espelho de CACHE_LIMIT_OPTIONS_GB do backend). */
export const DOWNLOAD_CACHE_OPTIONS_GB = [0, 2, 5, 10, 20] as const;

export interface ModChangelogEntry {
  version: string;
  publishedAt?: string;
  /** HTML cru da fonte: passa pelo parseChangelogHtml antes de aparecer. */
  html: string;
}

export interface ModChangelog {
  entries: ModChangelogEntry[];
  olderCount: number;
}

export interface ForgeUpdateCheckResult {
  sptVersionUsed: string;
  updates: ForgeUpdateItem[];
  blocked: ForgeUpdateItem[];
  upToDate: ForgeUpdateItem[];
  incompatible: ForgeUpdateItem[];
  infoOnly: ForgeUpdateItem[];
  unmatched: string[];
  skippedByBudget?: string[];
}

export interface ForgeSptVersion {
  version: string;
  modCount: number;
}

export interface ForgeStatusCacheEntry {
  name: string;
  status: "update" | "blocked" | "incompatible" | "info";
  version?: string;
  /** Só em "blocked": quem trava, pronto pra mostrar no hover do selo. */
  blockedBy?: string;
}

export interface ForgeCatalogVersion {
  id: number;
  version: string;
  sptConstraint?: string;
  link: string;
  downloads: number;
  contentLength?: number;
  compatibility?: "compatible" | "incompatible" | "unknown";
}

export interface ForgeCatalogMod {
  id: number;
  guid: string;
  name: string;
  slug: string;
  teaser?: string;
  thumbnail?: string;
  downloads: number;
  author?: string;
  category?: string;
  fikaCompatible?: boolean;
  detailUrl?: string;
  versions: ForgeCatalogVersion[];
  /** Versão mais nova compatível com a instância, quando a busca foi filtrada por versão do SPT. */
  compatibleVersionId?: number;
  installed?: boolean;
  installedVersion?: string;
}

export interface ForgeSearchResult {
  mods: ForgeCatalogMod[];
  page: number;
  lastPage: number;
  total: number;
}

export interface ForgeCategory {
  id: number;
  title: string;
  slug: string;
}

export interface InstallResult {
  success: boolean;
  message: string;
  /** Cancelado na fila pela pessoa: não é erro, não vira aviso vermelho. */
  cancelled?: boolean;
  /** Veio do cache de downloads. */
  fromCache?: boolean;
  needsConfirmation?: boolean;
  tmpDir?: string;
  rootEntries?: string[];
  archivePath?: string;
}

export interface AppUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadPageUrl?: string;
  releaseUrl?: string;
  releaseName?: string;
}

export interface ModManagerAPI {
  getSptPath: () => Promise<{ path: string; serverRoot: string; split: boolean } | null>;
  selectSptFolder: () => Promise<{ success: boolean; path?: string; serverRoot?: string; split?: boolean; message?: string }>;
  openModHub: () => Promise<void>;
  scanMods: () => Promise<ModInfo[]>;
  installMod: () => Promise<InstallResult>;
  installModFromPath: (filePath: string) => Promise<InstallResult>;
  toggleMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  uninstallMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  renameMod: (modId: string, alias: string) => Promise<{ success: boolean; message: string }>;
  openModFolder: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  listProfiles: () => Promise<{ active: string; profiles: ModProfileSummary[] }>;
  createProfile: (nome: string) => Promise<{ success: boolean; message: string; id?: string }>;
  renameProfile: (id: string, nome: string) => Promise<{ success: boolean; message: string }>;
  deleteProfile: (id: string) => Promise<{ success: boolean; message: string }>;
  switchProfile: (id: string) => Promise<ProfileSwitchResult>;
  exportProfile: () => Promise<{ success: boolean; message: string }>;
  importProfile: () => Promise<{
    success: boolean;
    message: string;
    id?: string;
    name?: string;
    modCount?: number;
    missingCount?: number;
  }>;
  getSptVersion: () => Promise<string | undefined>;
  detectConflicts: () => Promise<ConflictReport>;
  getSptSemver: () => Promise<string | undefined>;
  getSptVersionOverride: () => Promise<string | null>;
  getModSources: () => Promise<{ sources: ModSourceInfo[]; activeKey: string }>;
  setModSource: (key: string) => Promise<{ success: boolean; message?: string; activeKey?: string }>;
  setSptVersionOverride: (value: string) => Promise<void>;
  getForgeSptVersions: () => Promise<ForgeSptVersion[]>;
  getForgeCache: () => Promise<{ statusCache: ForgeStatusCacheEntry[] | null; checkedAt: string | null }>;
  setForgeCache: (statusCache: ForgeStatusCacheEntry[]) => Promise<void>;
  checkForgeUpdates: (
    mods: { name: string; originalName: string; version?: string; guid?: string }[],
    sptVersion: string
  ) => Promise<{ success: boolean; result?: ForgeUpdateCheckResult; message?: string }>;
  searchForgeMods: (params: {
    /** Ordenação aceita pela fonte. "-" inverte o sentido. */
    sort?: "-downloads" | "-updated_at" | "-created_at" | "name";
    query?: string;
    categorySlug?: string;
    sptVersionConstraint?: string;
    markVersion?: string;
    perPage?: number;
    page?: number;
    fikaOnly?: boolean;
  }) => Promise<{ success: boolean; result?: ForgeSearchResult; message?: string }>;
  getForgeCategories: () => Promise<ForgeCategory[]>;
  checkAppUpdate: () => Promise<AppUpdateInfo>;
  onForgeCheckProgress: (callback: (data: { done: number; total: number }) => void) => () => void;
  openReleasePage: (url: string) => Promise<{ success: boolean }>;
  getDiagnostics: () => Promise<{ appVersion: string; os: string; homeDir: string; reportPage: string | null }>;
  copyText: (texto: string) => Promise<{ success: boolean }>;
  fetchModCategories: (ids: number[]) => Promise<Record<string, string>>;
  getCustomCategories: () => Promise<CustomCategories>;
  saveCustomCategories: (custom: CustomCategories) => Promise<CustomCategories>;
  openForgeModPage: (modId: number, secao?: "versions") => Promise<{ success: boolean; message?: string }>;
  fetchModChangelog: (
    modId: number,
    currentVersion?: string,
    targetVersion?: string
  ) => Promise<{ success: boolean; result?: ModChangelog; message?: string }>;
  findForgeDownloadsForNames: (
    entries: { name: string; guid?: string; version?: string; id?: number }[]
  ) => Promise<
    Record<string, { downloadLink: string; version?: string; forgeName?: string; guid?: string; author?: string; modId?: number }>
  >;
  findForgeDownloadForName: (
    name: string,
    sptVersion?: string
  ) => Promise<{ found: boolean; downloadLink?: string; version?: string; forgeName?: string }>;
  fetchModDependencies: (modId: number | string, modVersion: string) => Promise<ModDependencyInfo[]>;
  fetchModDependenciesBatch: (chaves: string[]) => Promise<Record<string, ModDependencyInfo[]>>;
  installForgeMod: (
    jobId: string,
    downloadLink: string,
    suggestedName: string,
    forgeInfo?: { id?: number; name?: string; author?: string; version?: string; guid?: string },
    /** Ids da fila que precisam instalar antes deste (dependências, ordem de um lote). */
    after?: string[]
  ) => Promise<InstallResult>;
  /** A fila inteira a cada mudança (estado, ordem, progresso a cada ~150 ms). */
  onDownloadQueue: (callback: (snapshot: DownloadQueueJob[]) => void) => () => void;
  getDownloadQueue: () => Promise<DownloadQueueJob[]>;
  controlDownload: (action: "pause" | "resume" | "cancel" | "up" | "down", jobId: string) => Promise<boolean>;
  /** Cancela o que está esperando (na fila ou pausado). Devolve quantos. */
  cancelWaitingDownloads: () => Promise<number>;
  /** Quais executáveis existem nesta instância. */
  getLaunchTargets: () => Promise<{ server: boolean; launcher: boolean }>;
  launchSpt: (alvo: "server" | "launcher") => Promise<{ success: boolean; message: string }>;
  /** Vincula o mod (pelo nome original da pasta) a uma página do catálogo; versão opcional. */
  setManualForgeMatch: (folderName: string, referencia: string, versao?: string) => Promise<{ success: boolean; message: string; modName?: string }>;
  clearManualForgeMatch: (folderName: string) => Promise<{ success: boolean }>;
  /** id do catálogo -> compatível com Fika (null = a página não informa / não existe). */
  fetchModFika: (ids: number[]) => Promise<Record<string, boolean | null>>;
  /** Link de download de uma versão específica (pra forçar uma atualização bloqueada). */
  resolveVersionLink: (modId: number, versao: string) => Promise<string | null>;
  getMaxDownloads: () => Promise<number>;
  setMaxDownloads: (n: number) => Promise<number>;
  getDownloadCacheInfo: () => Promise<DownloadCacheInfo>;
  /** Só aceita os valores de DOWNLOAD_CACHE_OPTIONS_GB. */
  setDownloadCacheLimit: (gb: number) => Promise<DownloadCacheInfo>;
  clearDownloadCache: () => Promise<DownloadCacheInfo & { kept: number }>;
  confirmUnrecognizedInstall: (tmpDir: string, archivePath: string) => Promise<InstallResult>;
  abortUnrecognizedInstall: (tmpDir: string) => Promise<{ success: boolean; message: string }>;
}

declare global {
  interface Window {
    modManagerAPI: ModManagerAPI;
  }
}