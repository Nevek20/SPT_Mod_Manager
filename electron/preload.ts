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
  renameMod: (modId: string, alias: string) => ipcRenderer.invoke("rename-mod", modId, alias),
  openModFolder: (mod: ModInfo) => ipcRenderer.invoke("open-mod-folder", mod),
  listProfiles: () => ipcRenderer.invoke("list-profiles"),
  createProfile: (nome: string) => ipcRenderer.invoke("create-profile", nome),
  renameProfile: (id: string, nome: string) => ipcRenderer.invoke("rename-profile", id, nome),
  deleteProfile: (id: string) => ipcRenderer.invoke("delete-profile", id),
  switchProfile: (id: string) => ipcRenderer.invoke("switch-profile", id),
  exportProfile: () => ipcRenderer.invoke("export-profile"),
  importProfile: () => ipcRenderer.invoke("import-profile"),
  getSptVersion: () => ipcRenderer.invoke("get-spt-version"),
  detectConflicts: () => ipcRenderer.invoke("detect-conflicts"),
  getSptSemver: () => ipcRenderer.invoke("get-spt-semver"),
  getSptVersionOverride: () => ipcRenderer.invoke("get-spt-version-override"),
  getModSources: () => ipcRenderer.invoke("get-mod-sources"),
  setModSource: (key: string) => ipcRenderer.invoke("set-mod-source", key),
  setSptVersionOverride: (value: string) => ipcRenderer.invoke("set-spt-version-override", value),
  getForgeSptVersions: () => ipcRenderer.invoke("get-forge-spt-versions"),
  getForgeCache: () => ipcRenderer.invoke("get-forge-cache"),
  setForgeCache: (statusCache: { name: string; status: string; version?: string }[]) =>
    ipcRenderer.invoke("set-forge-cache", statusCache),
  checkForgeUpdates: (mods: { name: string; originalName: string; version?: string; guid?: string }[], sptVersion: string) =>
    ipcRenderer.invoke("check-forge-updates", mods, sptVersion),
  searchForgeMods: (params: { query?: string; categorySlug?: string; sptVersionConstraint?: string; markVersion?: string; perPage?: number; sort?: string; page?: number; fikaOnly?: boolean }) =>
    ipcRenderer.invoke("search-forge-mods", params),
  getForgeCategories: () => ipcRenderer.invoke("get-forge-categories"),
  checkAppUpdate: () => ipcRenderer.invoke("check-app-update"),
  onForgeCheckProgress: (callback: (data: { done: number; total: number }) => void) => {
    const handler = (_e: unknown, data: { done: number; total: number }) => callback(data);
    ipcRenderer.on("forge-check-progress", handler);
    return () => ipcRenderer.removeListener("forge-check-progress", handler);
  },
  openReleasePage: (url: string) => ipcRenderer.invoke("open-release-page", url),
  getDiagnostics: () => ipcRenderer.invoke("get-diagnostics"),
  copyText: (texto: string) => ipcRenderer.invoke("copy-text", texto),
  fetchModCategories: (ids: number[]) => ipcRenderer.invoke("fetch-mod-categories", ids),
  fetchModChangelog: (modId: number, currentVersion?: string, targetVersion?: string) =>
    ipcRenderer.invoke("fetch-mod-changelog", modId, currentVersion, targetVersion),
  getCustomCategories: () => ipcRenderer.invoke("get-custom-categories"),
  getDownloadCacheInfo: () => ipcRenderer.invoke("get-download-cache-info"),
  setDownloadCacheLimit: (gb: number) => ipcRenderer.invoke("set-download-cache-limit", gb),
  clearDownloadCache: () => ipcRenderer.invoke("clear-download-cache"),
  saveCustomCategories: (custom: unknown) => ipcRenderer.invoke("save-custom-categories", custom),
  openForgeModPage: (modId: number, secao?: "versions") => ipcRenderer.invoke("open-forge-mod-page", modId, secao),
  findForgeDownloadsForNames: (entries: { name: string; guid?: string; version?: string; id?: number }[]) =>
    ipcRenderer.invoke("find-forge-downloads-for-names", entries),
  findForgeDownloadForName: (name: string, sptVersion?: string) =>
    ipcRenderer.invoke("find-forge-download-for-name", name, sptVersion),
  fetchModDependencies: (modId: number | string, modVersion: string) =>
    ipcRenderer.invoke("fetch-mod-dependencies", modId, modVersion),
  fetchModDependenciesBatch: (chaves: string[]) =>
    ipcRenderer.invoke("fetch-mod-dependencies-batch", chaves),
  installForgeMod: (
    jobId: string,
    downloadLink: string,
    suggestedName: string,
    forgeInfo?: { id?: number; name?: string; author?: string; version?: string; guid?: string },
    after?: string[]
  ) => ipcRenderer.invoke("install-forge-mod", jobId, downloadLink, suggestedName, forgeInfo, after),
  confirmUnrecognizedInstall: (tmpDir: string, archivePath: string) =>
    ipcRenderer.invoke("install-mod-confirm", tmpDir, archivePath),
  abortUnrecognizedInstall: (tmpDir: string) => ipcRenderer.invoke("install-mod-abort", tmpDir),
  onDownloadQueue: (callback: (snapshot: unknown[]) => void) => {
    const handler = (_event: unknown, snapshot: unknown[]) => callback(snapshot);
    ipcRenderer.on("download-queue", handler);
    return () => ipcRenderer.removeListener("download-queue", handler);
  },
  getDownloadQueue: () => ipcRenderer.invoke("get-download-queue"),
  controlDownload: (action: string, jobId: string) => ipcRenderer.invoke("download-queue-control", action, jobId),
  cancelWaitingDownloads: () => ipcRenderer.invoke("download-queue-cancel-waiting"),
  getHardwareAcceleration: () => ipcRenderer.invoke("get-hardware-acceleration"),
  setHardwareAcceleration: (ligada: boolean) => ipcRenderer.invoke("set-hardware-acceleration", ligada),
  ackGpuNotice: () => ipcRenderer.invoke("ack-gpu-notice"),
  relaunchApp: () => ipcRenderer.invoke("relaunch-app"),
  getLaunchTargets: () => ipcRenderer.invoke("get-launch-targets"),
  launchSpt: (alvo: "server" | "launcher") => ipcRenderer.invoke("launch-spt", alvo),
  setManualForgeMatch: (folderName: string, referencia: string, versao?: string) =>
    ipcRenderer.invoke("set-manual-forge-match", folderName, referencia, versao),
  clearManualForgeMatch: (folderName: string) => ipcRenderer.invoke("clear-manual-forge-match", folderName),
  setManualVersion: (folderName: string, versao: string) => ipcRenderer.invoke("set-manual-version", folderName, versao),
  fetchModFika: (ids: number[]) => ipcRenderer.invoke("fetch-mod-fika", ids),
  resolveVersionLink: (modId: number, versao: string) => ipcRenderer.invoke("resolve-version-link", modId, versao),
  getMaxDownloads: () => ipcRenderer.invoke("get-max-downloads"),
  setMaxDownloads: (n: number) => ipcRenderer.invoke("set-max-downloads", n)
});