import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import Seven from "node-7z";
import { path7za } from "7zip-bin";
import { ModInfo, ModType, RegistryEntry } from "./types";

/**
 * Extrai .zip ou .7z pra uma pasta de destino.
 * .zip usa adm-zip (puro JS, sem binário externo).
 * .7z usa o binário 7za empacotado via 7zip-bin, através do node-7z.
 */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".zip") {
    return new Promise((resolve, reject) => {
      try {
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destDir, true);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  if (ext === ".7z") {
    return new Promise((resolve, reject) => {
      const stream = Seven.extractFull(archivePath, destDir, { $bin: path7za });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
  }

  return Promise.reject(new Error(`Formato de arquivo não suportado: ${ext}. Use .zip ou .7z.`));
}

// --- Pastas relevantes dentro de uma instância SPT ---
const SERVER_MODS_DIR = ["user", "mods"];
const SERVER_MODS_DISABLED_DIR = ["user", "mods.disabled"];
const CLIENT_PLUGINS_DIR = ["BepInEx", "plugins"];
const CLIENT_PLUGINS_DISABLED_DIR = ["BepInEx", "plugins.disabled"];

function p(sptPath: string, parts: string[]): string {
  return path.join(sptPath, ...parts);
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Confirma que a pasta selecionada é realmente uma instância SPT válida.
 * Checamos por marcadores conhecidos em vez de confiar cegamente no usuário.
 */
export function validateSptPath(sptPath: string): { valid: boolean; reason?: string } {
  if (!fs.existsSync(sptPath)) {
    return { valid: false, reason: "Pasta não existe." };
  }
  const hasServerExe = fs.existsSync(path.join(sptPath, "SPT.Server.exe"));
  const hasUserFolder = fs.existsSync(path.join(sptPath, "user"));
  const hasBepInEx = fs.existsSync(path.join(sptPath, "BepInEx"));

  if (!hasServerExe && !(hasUserFolder && hasBepInEx)) {
    return {
      valid: false,
      reason: "Não parece ser uma pasta de instância SPT (faltando SPT.Server.exe, user/ ou BepInEx/)."
    };
  }
  return { valid: true };
}

// --- Registro local de mods instalados via app (pra saber a diferença de "instalado manualmente") ---
function getRegistryPath(sptPath: string): string {
  return path.join(sptPath, ".spt-mod-manager-registry.json");
}

function loadRegistry(sptPath: string): RegistryEntry[] {
  const regPath = getRegistryPath(sptPath);
  if (!fs.existsSync(regPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(regPath, "utf-8"));
  } catch {
    return [];
  }
}

function saveRegistry(sptPath: string, entries: RegistryEntry[]) {
  fs.writeFileSync(getRegistryPath(sptPath), JSON.stringify(entries, null, 2), "utf-8");
}

function addToRegistry(sptPath: string, entry: RegistryEntry) {
  const reg = loadRegistry(sptPath);
  const filtered = reg.filter((e) => e.id !== entry.id);
  filtered.push(entry);
  saveRegistry(sptPath, filtered);
}

function removeFromRegistry(sptPath: string, id: string) {
  const reg = loadRegistry(sptPath);
  saveRegistry(sptPath, reg.filter((e) => e.id !== id));
}

// --- Load order (server mods carregam em ordem alfabética; prefixamos com número) ---
function stripLoadOrderPrefix(name: string): { order: number; cleanName: string } {
  const match = name.match(/^(\d{2})_(.+)$/);
  if (match) {
    return { order: parseInt(match[1], 10), cleanName: match[2] };
  }
  return { order: 99, cleanName: name };
}

// --- Escanear mods instalados ---
export function scanMods(sptPath: string): ModInfo[] {
  const registry = loadRegistry(sptPath);
  const registryIds = new Set(registry.map((r) => r.id));
  const mods: ModInfo[] = [];

  // Server mods (ativos)
  const serverDir = p(sptPath, SERVER_MODS_DIR);
  if (fs.existsSync(serverDir)) {
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      mods.push({
        id: entry.name,
        name: cleanName,
        type: "server",
        enabled: true,
        installedManually: !registryIds.has(entry.name),
        loadOrder: order
      });
    }
  }

  // Server mods (desabilitados)
  const serverDisabledDir = p(sptPath, SERVER_MODS_DISABLED_DIR);
  if (fs.existsSync(serverDisabledDir)) {
    for (const entry of fs.readdirSync(serverDisabledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      mods.push({
        id: entry.name,
        name: cleanName,
        type: "server",
        enabled: false,
        installedManually: !registryIds.has(entry.name),
        loadOrder: order
      });
    }
  }

  // Client mods (ativos) — plugins soltos (.dll) ou em subpastas
  const clientDir = p(sptPath, CLIENT_PLUGINS_DIR);
  if (fs.existsSync(clientDir)) {
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        mods.push({
          id: entry.name,
          name: entry.name.replace(/\.dll$/i, ""),
          type: "client",
          enabled: true,
          installedManually: !registryIds.has(entry.name),
          loadOrder: 0
        });
      }
    }
  }

  // Client mods (desabilitados)
  const clientDisabledDir = p(sptPath, CLIENT_PLUGINS_DISABLED_DIR);
  if (fs.existsSync(clientDisabledDir)) {
    for (const entry of fs.readdirSync(clientDisabledDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        mods.push({
          id: entry.name,
          name: entry.name.replace(/\.dll$/i, ""),
          type: "client",
          enabled: false,
          installedManually: !registryIds.has(entry.name),
          loadOrder: 0
        });
      }
    }
  }

  return mods.sort((a, b) => a.loadOrder - b.loadOrder || a.name.localeCompare(b.name));
}

// --- Instalar mod a partir de um .zip ou .7z ---
export async function installModFromArchive(sptPath: string, archivePath: string): Promise<{ success: boolean; message: string }> {
  const tmpExtractDir = path.join(sptPath, ".tmp-mod-extract-" + Date.now());
  try {
    ensureDir(tmpExtractDir);
    await extractArchive(archivePath, tmpExtractDir);

    const topLevel = fs.readdirSync(tmpExtractDir, { withFileTypes: true });

    // Caso 1: zip já contém a estrutura "user/" e/ou "BepInEx/" na raiz
    const hasUserFolder = topLevel.some((e) => e.isDirectory() && e.name.toLowerCase() === "user");
    const hasBepInExFolder = topLevel.some((e) => e.isDirectory() && e.name.toLowerCase() === "bepinex");

    if (hasUserFolder || hasBepInExFolder) {
      copyRecursive(tmpExtractDir, sptPath);
      cleanup(tmpExtractDir);
      addToRegistry(sptPath, {
        id: "estrutura-mesclada-" + Date.now(),
        displayName: path.parse(archivePath).name,
        type: hasUserFolder && hasBepInExFolder ? "server" : hasUserFolder ? "server" : "client",
        installedAt: new Date().toISOString(),
        source: "archive-install"
      });
      return { success: true, message: "Mod instalado (estrutura completa detectada)." };
    }

    // Caso 2: zip contém DLLs soltas ou uma única pasta -> tentar identificar client vs server
    const dllFiles = findFilesRecursive(tmpExtractDir, ".dll");
    const hasPackageJson = findFilesRecursive(tmpExtractDir, "package.json").length > 0;

    let destBase: string;
    let modId: string;
    let type: ModType;

    if (hasPackageJson && dllFiles.length === 0) {
      // Server mod: assume que a raiz extraída (ou sua única subpasta) é a pasta do mod
      const rootEntries = fs.readdirSync(tmpExtractDir, { withFileTypes: true });
      const singleDir = rootEntries.length === 1 && rootEntries[0].isDirectory() ? rootEntries[0].name : null;
      const sourceDir = singleDir ? path.join(tmpExtractDir, singleDir) : tmpExtractDir;
      modId = singleDir ?? path.parse(archivePath).name;
      destBase = p(sptPath, SERVER_MODS_DIR);
      ensureDir(destBase);
      copyRecursive(sourceDir, path.join(destBase, modId));
      type = "server";
    } else if (dllFiles.length > 0) {
      // Client mod: copia pasta (ou soltas) pra BepInEx/plugins
      destBase = p(sptPath, CLIENT_PLUGINS_DIR);
      ensureDir(destBase);
      const rootEntries = fs.readdirSync(tmpExtractDir, { withFileTypes: true });
      const singleDir = rootEntries.length === 1 && rootEntries[0].isDirectory() ? rootEntries[0].name : null;
      if (singleDir) {
        modId = singleDir;
        copyRecursive(path.join(tmpExtractDir, singleDir), path.join(destBase, singleDir));
      } else {
        modId = path.parse(archivePath).name;
        copyRecursive(tmpExtractDir, path.join(destBase, modId));
      }
      type = "client";
    } else {
      cleanup(tmpExtractDir);
      return {
        success: false,
        message: "Não consegui identificar o tipo do mod (sem DLL, sem package.json, sem pasta user/BepInEx). Instale manualmente e o app vai detectar."
      };
    }

    cleanup(tmpExtractDir);
    addToRegistry(sptPath, {
      id: modId,
      displayName: modId,
      type,
      installedAt: new Date().toISOString(),
      source: "archive-install"
    });
    return { success: true, message: `Mod "${modId}" instalado como ${type === "server" ? "server mod" : "client mod"}.` };
  } catch (err) {
    cleanup(tmpExtractDir);
    return { success: false, message: "Erro ao instalar: " + (err as Error).message };
  }
}

// --- Habilitar/desabilitar (move entre pasta ativa e .disabled) ---
export function toggleMod(sptPath: string, mod: ModInfo): { success: boolean; message: string } {
  const isServer = mod.type === "server";
  const activeDir = p(sptPath, isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR);
  const disabledDir = p(sptPath, isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR);
  ensureDir(disabledDir);
  ensureDir(activeDir);

  const from = mod.enabled ? path.join(activeDir, mod.id) : path.join(disabledDir, mod.id);
  const to = mod.enabled ? path.join(disabledDir, mod.id) : path.join(activeDir, mod.id);

  if (!fs.existsSync(from)) {
    return { success: false, message: "Arquivo/pasta do mod não encontrado: " + from };
  }
  fs.renameSync(from, to);
  return { success: true, message: mod.enabled ? "Mod desabilitado." : "Mod habilitado." };
}

// --- Desinstalar ---
export function uninstallMod(sptPath: string, mod: ModInfo): { success: boolean; message: string } {
  const isServer = mod.type === "server";
  const dir = p(sptPath, mod.enabled ? (isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR) : isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR);
  const target = path.join(dir, mod.id);
  if (!fs.existsSync(target)) {
    return { success: false, message: "Mod não encontrado: " + target };
  }
  fs.rmSync(target, { recursive: true, force: true });
  removeFromRegistry(sptPath, mod.id);
  return { success: true, message: "Mod removido." };
}

// --- Reordenar load order (só server mods) ---
export function reorderServerMods(sptPath: string, orderedIds: string[]): { success: boolean; message: string } {
  const activeDir = p(sptPath, SERVER_MODS_DIR);
  if (!fs.existsSync(activeDir)) return { success: false, message: "Pasta de server mods não existe." };

  orderedIds.forEach((id, index) => {
    const { cleanName } = stripLoadOrderPrefix(id);
    const prefix = String(index + 1).padStart(2, "0");
    const newName = `${prefix}_${cleanName}`;
    const oldPath = path.join(activeDir, id);
    const newPath = path.join(activeDir, newName);
    if (fs.existsSync(oldPath) && oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }
  });
  return { success: true, message: "Ordem de carregamento atualizada." };
}

// --- Helpers de sistema de arquivos ---
function copyRecursive(src: string, dest: string) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function findFilesRecursive(dir: string, extOrName: string): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFilesRecursive(fullPath, extOrName));
    } else if (entry.name.toLowerCase().endsWith(extOrName.toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function cleanup(tmpDir: string) {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
