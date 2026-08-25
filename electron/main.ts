import { MOD_SOURCES, getSourceByKey } from "./sources";
import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from "electron";
import path from "path";
import fs from "fs";
import Store from "electron-store";
import {
  resolveSptInstance,
  hasServerExe,
  scanMods,
  installModFromArchive,
  toggleMod,
  uninstallMod,
  setModAlias,
  resolveModPath,
  exportModListData,
  compareModList,
  detectConflicts,
  detectSptVersion,
  detectSptSemver,
  setModSource,
  getModSource,
  pingModSource,
  checkSptCompatibility,
  checkForgeUpdates,
  getForgeSptVersions,
  searchForgeMods,
  getForgeCategories,
  installForgeModVersion,
  findForgeDownloadForName,
  findForgeDownloadsForNames,
  checkAppUpdate,
  finalizeUnrecognizedInstall,
  discardPendingInstall
} from "./modManager";
import { InstanceConfig, ModInfo } from "./types";

const store = new Store<InstanceConfig>({
  defaults: { sptPath: null, serverRoot: null, sptVersionOverride: null, forgeStatusCache: null, forgeCheckedAt: null, modSourceKey: null }
});

// Aplica a fonte salva antes de qualquer chamada de rede. Sem isto o app usaria
// o padrão até a primeira troca, ignorando a escolha do usuário na sessão toda.
setModSource(store.get("modSourceKey"));

// sptPath (armazenado) é sempre a raiz de CLIENT. serverRoot é igual a sptPath na
// grande maioria das instâncias; só é diferente quando a instalação é "dividida" (o
// instalador da SPT 4.x pode criar uma subpasta separada pro server). O fallback aqui
// cobre configs salvas antes dessa mudança, onde serverRoot nunca foi definido.
function getServerRoot(): string | null {
  const sptPath = store.get("sptPath");
  if (!sptPath) return null;
  const stored = store.get("serverRoot") || sptPath;

  // Auto-conserto: quem configurou a instância antes de a gente entender o layout do
  // SPT 4.1 (pasta SPT_Runtime) ficou com uma raiz de servidor errada salva — e uma
  // instalação errada cria <raiz>/user/mods, que fazia a detecção antiga confirmar o
  // erro pra sempre. Se o que está salvo não tem o executável do servidor e a detecção
  // acha um lugar melhor, corrige sozinho.
  //
  // A checagem barata vem primeiro de propósito: getServerRoot() roda em toda chamada de
  // IPC (scan, conflitos, install, toggle, uninstall, export...), e resolveSptInstance
  // faz readdir + um monte de existsSync de forma síncrona na main process. No caminho
  // normal — raiz salva correta — isso aqui custa um existsSync e para.
  if (hasServerExe(stored)) return stored;

  const better = resolveSptInstance(sptPath)?.instance.serverRoot;
  if (better && better !== stored && hasServerExe(better)) {
    store.set("serverRoot", better);
    return better;
  }
  return stored;
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- IPC: configuração da instância ---
ipcMain.handle("get-spt-path", () => {
  const path = store.get("sptPath");
  if (!path) return null;
  const serverRoot = getServerRoot()!;
  return { path, serverRoot, split: serverRoot !== path };
});

ipcMain.handle("open-mod-hub", () => {
  shell.openExternal(getModSource().siteUrl);
});

ipcMain.handle("select-spt-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const chosen = result.filePaths[0];
  const resolved = resolveSptInstance(chosen);
  if (!resolved) {
    return {
      success: false,
      message: "Não achei uma instância SPT nessa pasta nem nas subpastas diretas dela. Selecione a pasta que tem o SPT.Server.exe."
    };
  }
  store.set("sptPath", resolved.instance.clientRoot);
  store.set("serverRoot", resolved.instance.serverRoot);
  return {
    success: true,
    path: resolved.instance.clientRoot,
    serverRoot: resolved.instance.serverRoot,
    split: resolved.instance.split,
    message: resolved.autoDetected
      ? resolved.instance.split
        ? `Instância dividida detectada — client em "${resolved.instance.clientRoot}", server em "${resolved.instance.serverRoot}".`
        : `Instância encontrada automaticamente em: ${resolved.instance.clientRoot}`
      : undefined
  };
});

// --- IPC: mods ---
ipcMain.handle("scan-mods", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return [];
  // A compatibilidade é calculada aqui (e não no scan) porque depende da versão do SPT
  // ESCOLHIDA pelo usuário, que o backend só conhece pelo store. Fazer aqui evita
  // duplicar a lógica de comparação de versão no processo de interface.
  const instanceVersion = store.get("sptVersionOverride") ?? detectSptSemver(sptPath, getServerRoot() ?? undefined);
  return scanMods(sptPath, getServerRoot()!).map((mod) => ({
    ...mod,
    sptCompatibility: checkSptCompatibility(mod.sptVersion, instanceVersion ?? undefined)
  }));
});

ipcMain.handle("get-spt-version", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return undefined;
  return detectSptVersion(sptPath);
});

ipcMain.handle("detect-conflicts", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { clientFileConflicts: [], duplicateServerNames: [] };
  return detectConflicts(sptPath, getServerRoot()!);
});

ipcMain.handle("get-spt-semver", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return undefined;
  // A raiz do servidor é onde mora o SPT.Server.exe, e no layout do 4.1 ela é
  // uma subpasta (SPT_Runtime) — passar só sptPath não acharia o executável.
  return detectSptSemver(sptPath, getServerRoot() ?? undefined);
});

ipcMain.handle("get-spt-version-override", () => store.get("sptVersionOverride"));

ipcMain.handle("get-mod-sources", () => ({
  sources: MOD_SOURCES.map(({ key, label, siteUrl }) => ({ key, label, siteUrl })),
  activeKey: getModSource().key
}));

ipcMain.handle("set-mod-source", async (_event, key: string) => {
  const source = getSourceByKey(key);
  // Confere que a fonte responde ANTES de salvar. Salvar primeiro deixaria o
  // usuário preso numa fonte fora do ar, sem entender por que nada carrega.
  const alive = await pingModSource(source.apiBase);
  if (!alive) return { success: false, message: `${source.label} não respondeu.` };
  store.set("modSourceKey", source.key);
  setModSource(source.key);
  return { success: true, activeKey: source.key };
});

ipcMain.handle("set-spt-version-override", (_event, value: string) => {
  store.set("sptVersionOverride", value || null);
});

ipcMain.handle("get-forge-spt-versions", () => getForgeSptVersions());

ipcMain.handle("get-forge-cache", () => ({
  statusCache: store.get("forgeStatusCache"),
  checkedAt: store.get("forgeCheckedAt")
}));

ipcMain.handle(
  "set-forge-cache",
  (_event, statusCache: { name: string; status: string; version?: string }[]) => {
    store.set("forgeStatusCache", statusCache as any);
    store.set("forgeCheckedAt", new Date().toISOString());
  }
);

ipcMain.handle("check-forge-updates", async (_event, mods: { name: string; originalName: string; version?: string; guid?: string }[], sptVersion: string) => {
  try {
    const result = await checkForgeUpdates(
      mods,
      sptVersion,
      (done, total) => {
        mainWindow?.webContents.send("forge-check-progress", { done, total });
      },
      store.get("sptPath") ?? undefined
    );
    return { success: true, result };
  } catch (err: any) {
    return { success: false, message: err?.message || "Falha ao verificar atualizações." };
  }
});

ipcMain.handle(
  "search-forge-mods",
  async (
    _event,
    params: { query?: string; categorySlug?: string; sptVersionConstraint?: string; markVersion?: string; perPage?: number; sort?: string; page?: number }
  ) => {
    try {
      const result = await searchForgeMods({ ...params, sptPath: store.get("sptPath") ?? undefined });
      return { success: true, result };
    } catch (err: any) {
      return { success: false, message: err?.message || "Falha ao buscar mods na Forge." };
    }
  }
);

ipcMain.handle("get-forge-categories", () => getForgeCategories());

ipcMain.handle("check-app-update", () => checkAppUpdate(app.getVersion()));

/** Páginas de crédito linkadas no rodapé. Ver a allowlist logo abaixo. */
const CREDIT_URLS = ["https://github.com/GAVRIEL-911"];

ipcMain.handle("open-release-page", (_event, url: string) => {
  // Só abre a página do mod na Forge ou o release no próprio repo — a URL vem do
  // processo renderer, que não é totalmente confiável pra mandar abrir qualquer
  // coisa no navegador.
  // A página do mod muda junto com a fonte, então a allowlist não pode ser um
  // domínio fixo: valida contra o site da fonte ativa e o repositório.
  const source = getModSource();
  const allowed =
    url.startsWith(source.siteUrl) ||
    /^https:\/\/github\.com\/Nevek20\/SPT_Mod_Manager\//.test(url) ||
    // Links de crédito que o próprio app renderiza. Comparação exata em vez de
    // prefixo: a lista existe pra abrir estas páginas e nada mais.
    CREDIT_URLS.includes(url);
  if (allowed) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle("find-forge-downloads-for-names", async (_event, entries: { name: string; guid?: string }[]) => {
  try {
    return await findForgeDownloadsForNames(
      entries,
      (done, total) => {
        mainWindow?.webContents.send("forge-check-progress", { done, total });
      },
      store.get("sptPath") ?? undefined
    );
  } catch {
    return {};
  }
});

ipcMain.handle("find-forge-download-for-name", async (_event, name: string, sptVersion?: string) => {
  try {
    return await findForgeDownloadForName(name, sptVersion);
  } catch (err: any) {
    return { found: false };
  }
});

ipcMain.handle(
  "install-forge-mod",
  async (
    _event,
    jobId: string,
    downloadLink: string,
    suggestedName: string,
    forgeInfo?: { id?: number; name?: string; author?: string; version?: string; guid?: string }
  ) => {
    const sptPath = store.get("sptPath");
    if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
    return installForgeModVersion(
      sptPath,
      getServerRoot()!,
      downloadLink,
      suggestedName,
      (receivedBytes, totalBytes) => {
        mainWindow?.webContents.send("download-progress", { jobId, receivedBytes, totalBytes });
      },
      forgeInfo
    );
  }
);

ipcMain.handle("install-mod", async () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Arquivo de mod", extensions: ["zip", "7z", "rar"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, message: "Cancelado." };

  return installModFromArchive(sptPath, getServerRoot()!, result.filePaths[0]);
});

ipcMain.handle("install-mod-from-path", async (_event, filePath: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".zip" && ext !== ".7z" && ext !== ".rar") {
    return { success: false, message: `Arquivo "${path.basename(filePath)}" não é .zip, .7z nem .rar.` };
  }

  return installModFromArchive(sptPath, getServerRoot()!, filePath);
});

ipcMain.handle("install-mod-confirm", (_event, tmpDir: string, archivePath: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return finalizeUnrecognizedInstall(sptPath, getServerRoot()!, tmpDir, archivePath);
});

ipcMain.handle("install-mod-abort", (_event, tmpDir: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return discardPendingInstall(sptPath, tmpDir);
});

ipcMain.handle("toggle-mod", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return toggleMod(sptPath, getServerRoot()!, mod);
});

ipcMain.handle("uninstall-mod", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return uninstallMod(sptPath, getServerRoot()!, mod);
});

ipcMain.handle("rename-mod", (_event, modId: string, alias: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return setModAlias(sptPath, modId, alias);
});

ipcMain.handle("open-mod-folder", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const target = resolveModPath(sptPath, getServerRoot()!, mod);
  if (!fs.existsSync(target)) {
    return { success: false, message: "Caminho do mod não encontrado: " + target };
  }
  if (fs.statSync(target).isDirectory()) {
    shell.openPath(target);
  } else {
    shell.showItemInFolder(target);
  }
  return { success: true, message: "Pasta aberta." };
});

ipcMain.handle("export-mod-list", async () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const data = exportModListData(sptPath, getServerRoot()!);
  const result = await dialog.showSaveDialog({
    defaultPath: "spt-modlist.json",
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || !result.filePath) return { success: false, message: "Cancelado." };

  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), "utf-8");
  return { success: true, message: `Lista exportada com ${data.mods.length} mod(s) para ${path.basename(result.filePath)}.` };
});

ipcMain.handle("import-mod-list", async () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, message: "Cancelado." };

  try {
    const raw = fs.readFileSync(result.filePaths[0], "utf-8");
    const parsed = JSON.parse(raw);
    const names: string[] = Array.isArray(parsed.mods)
      ? parsed.mods.map((m: { name?: string }) => m.name).filter((n: unknown): n is string => typeof n === "string")
      : [];
    if (names.length === 0) {
      return { success: false, message: "Esse arquivo não parece uma lista de mods exportada por este app." };
    }
    // Repassa os GUIDs da lista (quando existirem) pra que a restauração case por
    // identificador exato em vez de tentar adivinhar pelo nome da pasta.
    const guidByName: Record<string, string> = {};
    for (const entry of parsed.mods as { name?: string; guid?: string }[]) {
      if (typeof entry?.name === "string" && typeof entry?.guid === "string") {
        guidByName[entry.name] = entry.guid;
      }
    }
    const comparison = compareModList(sptPath, getServerRoot()!, names);
    return {
      success: true,
      message: `Comparado com ${names.length} mod(s) da lista importada.`,
      comparison,
      guidByName
    };
  } catch (err) {
    return { success: false, message: "Erro ao ler o arquivo: " + (err as Error).message };
  }
});