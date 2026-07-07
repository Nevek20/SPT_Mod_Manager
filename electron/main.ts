import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from "electron";
import path from "path";
import fs from "fs";
import Store from "electron-store";
import {
  resolveSptPath,
  scanMods,
  installModFromArchive,
  toggleMod,
  uninstallMod,
  reorderServerMods,
  setModAlias,
  resolveModPath,
  exportModListData,
  compareModList,
  detectConflicts,
  detectSptVersion
} from "./modManager";
import { InstanceConfig, ModInfo } from "./types";

const MOD_HUB_URL = "https://hub.sp-tarkov.com/";

const store = new Store<InstanceConfig>({ defaults: { sptPath: null } });

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
ipcMain.handle("get-spt-path", () => store.get("sptPath"));

ipcMain.handle("open-mod-hub", () => {
  shell.openExternal(MOD_HUB_URL);
});

ipcMain.handle("select-spt-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const chosen = result.filePaths[0];
  const resolved = resolveSptPath(chosen);
  if (!resolved) {
    return {
      success: false,
      message: "Não achei uma instância SPT nessa pasta nem nas subpastas diretas dela. Selecione a pasta que tem o SPT.Server.exe."
    };
  }
  store.set("sptPath", resolved.path);
  return {
    success: true,
    path: resolved.path,
    message: resolved.autoDetected ? `Instância encontrada automaticamente em: ${resolved.path}` : undefined
  };
});

// --- IPC: mods ---
ipcMain.handle("scan-mods", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return [];
  return scanMods(sptPath);
});

ipcMain.handle("get-spt-version", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return undefined;
  return detectSptVersion(sptPath);
});

ipcMain.handle("detect-conflicts", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { clientFileConflicts: [], duplicateServerNames: [] };
  return detectConflicts(sptPath);
});

ipcMain.handle("install-mod", async () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Arquivo de mod", extensions: ["zip", "7z", "rar"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, message: "Cancelado." };

  return installModFromArchive(sptPath, result.filePaths[0]);
});

ipcMain.handle("install-mod-from-path", async (_event, filePath: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".zip" && ext !== ".7z" && ext !== ".rar") {
    return { success: false, message: `Arquivo "${path.basename(filePath)}" não é .zip, .7z nem .rar.` };
  }

  return installModFromArchive(sptPath, filePath);
});

ipcMain.handle("toggle-mod", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return toggleMod(sptPath, mod);
});

ipcMain.handle("uninstall-mod", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return uninstallMod(sptPath, mod);
});

ipcMain.handle("reorder-mods", (_event, orderedIds: string[]) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return reorderServerMods(sptPath, orderedIds);
});

ipcMain.handle("rename-mod", (_event, modId: string, alias: string) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };
  return setModAlias(sptPath, modId, alias);
});

ipcMain.handle("open-mod-folder", (_event, mod: ModInfo) => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const target = resolveModPath(sptPath, mod);
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

  const data = exportModListData(sptPath);
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
    const comparison = compareModList(sptPath, names);
    return {
      success: true,
      message: `Comparado com ${names.length} mod(s) da lista importada.`,
      comparison
    };
  } catch (err) {
    return { success: false, message: "Erro ao ler o arquivo: " + (err as Error).message };
  }
});
