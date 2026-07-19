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
  importModList: () => ipcRenderer.invoke("import-mod-list"),
  getSptVersion: () => ipcRenderer.invoke("get-spt-version"),
  detectConflicts: () => ipcRenderer.invoke("detect-conflicts"),
  getSptSemver: () => ipcRenderer.invoke("get-spt-semver"),
  getSptVersionOverride: () => ipcRenderer.invoke("get-spt-version-override"),
  setSptVersionOverride: (value: string) => ipcRenderer.invoke("set-spt-version-override", value),
  getForgeSptVersions: () => ipcRenderer.invoke("get-forge-spt-versions"),
  getForgeCache: () => ipcRenderer.invoke("get-forge-cache"),
  setForgeCache: (statusCache: { name: string; status: string; version?: string }[]) =>
    ipcRenderer.invoke("set-forge-cache", statusCache),
  checkForgeUpdates: (mods: { name: string; originalName: string; version?: string }[], sptVersion: string) =>
    ipcRenderer.invoke("check-forge-updates", mods, sptVersion),
  searchForgeMods: (params: { query?: string; categorySlug?: string; sptVersionConstraint?: string; sort?: string; page?: number }) =>
    ipcRenderer.invoke("search-forge-mods", params),
  getForgeCategories: () => ipcRenderer.invoke("get-forge-categories"),
  installForgeMod: (downloadLink: string, suggestedName: string) =>
    ipcRenderer.invoke("install-forge-mod", downloadLink, suggestedName),
  confirmUnrecognizedInstall: (tmpDir: string, archivePath: string) =>
    ipcRenderer.invoke("install-mod-confirm", tmpDir, archivePath),
  abortUnrecognizedInstall: (tmpDir: string) => ipcRenderer.invoke("install-mod-abort", tmpDir)
});