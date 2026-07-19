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
}

export interface ModListComparison {
  missing: string[];
  extra: string[];
}

export interface ConflictReport {
  clientFileConflicts: { fileName: string; mods: string[] }[];
  duplicateServerNames: { declaredName: string; mods: string[] }[];
}

export interface ForgeUpdateItem {
  name: string;
  currentVersion?: string;
  recommendedVersion?: string;
  downloadLink?: string;
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

export interface ModManagerAPI {
  getSptPath: () => Promise<string | null>;
  selectSptFolder: () => Promise<{ success: boolean; path?: string; message?: string }>;
  openModHub: () => Promise<void>;
  scanMods: () => Promise<ModInfo[]>;
  installMod: () => Promise<{ success: boolean; message: string }>;
  installModFromPath: (filePath: string) => Promise<{ success: boolean; message: string }>;
  toggleMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  uninstallMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  reorderMods: (orderedIds: string[]) => Promise<{ success: boolean; message: string }>;
  renameMod: (modId: string, alias: string) => Promise<{ success: boolean; message: string }>;
  openModFolder: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  exportModList: () => Promise<{ success: boolean; message: string }>;
  importModList: () => Promise<{ success: boolean; message: string; comparison?: ModListComparison }>;
  getSptVersion: () => Promise<string | undefined>;
  detectConflicts: () => Promise<ConflictReport>;
  getSptSemver: () => Promise<string | undefined>;
  getSptVersionOverride: () => Promise<string | null>;
  setSptVersionOverride: (value: string) => Promise<void>;
  getForgeSptVersions: () => Promise<ForgeSptVersion[]>;
  getForgeCache: () => Promise<{ statusCache: ForgeStatusCacheEntry[] | null; checkedAt: string | null }>;
  setForgeCache: (statusCache: ForgeStatusCacheEntry[]) => Promise<void>;
  checkForgeUpdates: (
    mods: { name: string; originalName: string; version?: string }[],
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
  installForgeMod: (downloadLink: string, suggestedName: string) => Promise<{ success: boolean; message: string }>;
}

declare global {
  interface Window {
    modManagerAPI: ModManagerAPI;
  }
}