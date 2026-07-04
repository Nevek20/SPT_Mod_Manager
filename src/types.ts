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
}

export interface ModListComparison {
  missing: string[];
  extra: string[];
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
}

declare global {
  interface Window {
    modManagerAPI: ModManagerAPI;
  }
}
