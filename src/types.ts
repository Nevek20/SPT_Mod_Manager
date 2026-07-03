export type ModType = "server" | "client" | "unknown";

export interface ModInfo {
  id: string;
  name: string;
  type: ModType;
  enabled: boolean;
  installedManually: boolean;
  loadOrder: number;
}

export interface ModManagerAPI {
  getSptPath: () => Promise<string | null>;
  selectSptFolder: () => Promise<{ success: boolean; path?: string; message?: string }>;
  scanMods: () => Promise<ModInfo[]>;
  installMod: () => Promise<{ success: boolean; message: string }>;
  toggleMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  uninstallMod: (mod: ModInfo) => Promise<{ success: boolean; message: string }>;
  reorderMods: (orderedIds: string[]) => Promise<{ success: boolean; message: string }>;
}

declare global {
  interface Window {
    modManagerAPI: ModManagerAPI;
  }
}
