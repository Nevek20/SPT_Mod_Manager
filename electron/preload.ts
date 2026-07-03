import { contextBridge, ipcRenderer } from "electron";
import { ModInfo } from "./types";

contextBridge.exposeInMainWorld("modManagerAPI", {
  getSptPath: () => ipcRenderer.invoke("get-spt-path"),
  selectSptFolder: () => ipcRenderer.invoke("select-spt-folder"),
  scanMods: () => ipcRenderer.invoke("scan-mods"),
  installMod: () => ipcRenderer.invoke("install-mod"),
  toggleMod: (mod: ModInfo) => ipcRenderer.invoke("toggle-mod", mod),
  uninstallMod: (mod: ModInfo) => ipcRenderer.invoke("uninstall-mod", mod),
  reorderMods: (orderedIds: string[]) => ipcRenderer.invoke("reorder-mods", orderedIds)
});
