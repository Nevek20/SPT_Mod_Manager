import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import Store from "electron-store";
import { validateSptPath, scanMods, installModFromArchive, toggleMod, uninstallMod, reorderServerMods } from "./modManager";
import { InstanceConfig, ModInfo } from "./types";

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

ipcMain.handle("select-spt-folder", async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) return { success: false };

  const chosen = result.filePaths[0];
  const validation = validateSptPath(chosen);
  if (!validation.valid) {
    return { success: false, message: validation.reason };
  }
  store.set("sptPath", chosen);
  return { success: true, path: chosen };
});

// --- IPC: mods ---
ipcMain.handle("scan-mods", () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return [];
  return scanMods(sptPath);
});

ipcMain.handle("install-mod", async () => {
  const sptPath = store.get("sptPath");
  if (!sptPath) return { success: false, message: "Nenhuma instância SPT configurada." };

  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Arquivo de mod", extensions: ["zip", "7z"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false, message: "Cancelado." };

  return installModFromArchive(sptPath, result.filePaths[0]);
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
