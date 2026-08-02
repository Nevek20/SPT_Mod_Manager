export type ModType = "server" | "client" | "hybrid" | "unknown";

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
  packageId?: string; // partes instaladas do mesmo arquivo compartilham esse id
  guid?: string; // GUID declarado pelo mod (SPT 4.0) — casamento exato com a Forge
  linkedModName?: string;
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
}

export interface ForgeCatalogVersion {
  id: number;
  version: string;
  sptConstraint?: string;
  link: string;
  downloads: number;
  contentLength?: number;
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
  exportModList: () => Promise<{ success: boolean; message: string }>;
  importModList: () => Promise<{
    success: boolean;
    message: string;
    comparison?: ModListComparison;
    guidByName?: Record<string, string>;
  }>;
  getSptVersion: () => Promise<string | undefined>;
  detectConflicts: () => Promise<ConflictReport>;
  getSptSemver: () => Promise<string | undefined>;
  getSptVersionOverride: () => Promise<string | null>;
  setSptVersionOverride: (value: string) => Promise<void>;
  getForgeSptVersions: () => Promise<ForgeSptVersion[]>;
  getForgeCache: () => Promise<{ statusCache: ForgeStatusCacheEntry[] | null; checkedAt: string | null }>;
  setForgeCache: (statusCache: ForgeStatusCacheEntry[]) => Promise<void>;
  checkForgeUpdates: (
    mods: { name: string; originalName: string; version?: string; guid?: string }[],
    sptVersion: string
  ) => Promise<{ success: boolean; result?: ForgeUpdateCheckResult; message?: string }>;
  searchForgeMods: (params: {
    query?: string;
    categorySlug?: string;
    sptVersionConstraint?: string;
    sort?: string;
    page?: number;
  }) => Promise<{ success: boolean; result?: ForgeSearchResult; message?: string }>;
  getForgeCategories: () => Promise<ForgeCategory[]>;
  checkAppUpdate: () => Promise<AppUpdateInfo>;
  onForgeCheckProgress: (callback: (data: { done: number; total: number }) => void) => () => void;
  openReleasePage: (url: string) => Promise<{ success: boolean }>;
  findForgeDownloadsForNames: (
    entries: { name: string; guid?: string }[]
  ) => Promise<Record<string, { downloadLink: string; version?: string; forgeName?: string; guid?: string }>>;
  findForgeDownloadForName: (
    name: string,
    sptVersion?: string
  ) => Promise<{ found: boolean; downloadLink?: string; version?: string; forgeName?: string }>;
  installForgeMod: (
    jobId: string,
    downloadLink: string,
    suggestedName: string,
    forgeInfo?: { name?: string; author?: string; version?: string; guid?: string }
  ) => Promise<InstallResult>;
  onDownloadProgress: (callback: (data: { jobId: string; receivedBytes: number; totalBytes: number }) => void) => () => void;
  confirmUnrecognizedInstall: (tmpDir: string, archivePath: string) => Promise<InstallResult>;
  abortUnrecognizedInstall: (tmpDir: string) => Promise<{ success: boolean; message: string }>;
}

declare global {
  interface Window {
    modManagerAPI: ModManagerAPI;
  }
}