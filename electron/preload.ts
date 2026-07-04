import { contextBridge, ipcRenderer } from "electron";
import { ModInfo } from "./types";

contextBridge.exposeInMainWorld("modManagerAPI", {
  getSptPath: () => ipcRenderer.invoke("get-spt-path"),
  selectSptFolder: () => ipcRenderer.invoke("select-spt-folder"),
  openModHub: () => ipcRenderer.invoke("open-mod-hub"),
  scanMods: () => ipcRenderer.invoke("scan-mods"),
  installMod: () => ipcRenderer.invoke("install-mod"),
  installModFromPath: (filePath: string) => ipcRenderer.invoke("install-mod-from-path", filePath),
  toggleMod: (mod: ModInfo) => ipcRenderer.invoke("toggle-mod", mod),
  uninstallMod: (mod: ModInfo) => ipcRenderer.invoke("uninstall-mod", mod),
  reorderMods: (orderedIds: string[]) => ipcRenderer.invoke("reorder-mods", orderedIds),
  renameMod: (modId: string, alias: string) => ipcRenderer.invoke("rename-mod", modId, alias),
  openModFolder: (mod: ModInfo) => ipcRenderer.invoke("open-mod-folder", mod),
  exportModList: () => ipcRenderer.invoke("export-mod-list"),
  importModList: () => ipcRenderer.invoke("import-mod-list")
});
