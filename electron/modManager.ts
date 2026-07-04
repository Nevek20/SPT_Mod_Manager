import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import Seven from "node-7z";
import { path7za } from "7zip-bin";
import { createExtractorFromFile } from "node-unrar-js";
import { ModInfo, ModType, RegistryEntry, ModListComparison } from "./types";

/**
 * Extrai .zip, .7z ou .rar pra uma pasta de destino.
 * .zip usa adm-zip (puro JS, sem binário externo).
 * .7z usa o binário 7za empacotado via 7zip-bin, através do node-7z.
 * .rar usa node-unrar-js (WASM da biblioteca oficial unrar, sem binário externo).
 */
async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === ".zip") {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destDir, true);
    return;
  }

  if (ext === ".7z") {
    return new Promise((resolve, reject) => {
      const stream = Seven.extractFull(archivePath, destDir, { $bin: path7za });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
  }

  if (ext === ".rar") {
    const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir });
    // A extração é "lazy" (generator) — precisa iterar pra realmente escrever os arquivos em disco.
    const { files } = extractor.extract();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _file of files) {
      // só percorrendo pra forçar a extração de cada entrada
    }
    return;
  }

  throw new Error(`Formato de arquivo não suportado: ${ext}. Use .zip, .7z ou .rar.`);
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
 * Lê version/author do package.json do mod, quando existe. É best-effort:
 * client mods (BepInEx) raramente têm isso, então retorna vazio sem erro nesses casos.
 */
function readModMetadata(modPath: string): { version?: string; author?: string } {
  try {
    if (!fs.existsSync(modPath) || !fs.statSync(modPath).isDirectory()) return {};
    const pkgPath = path.join(modPath, "package.json");
    if (!fs.existsSync(pkgPath)) return {};
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
    return { version: typeof pkg.version === "string" ? pkg.version : undefined, author };
  } catch {
    return {};
  }
}

/**
 * Resolve o caminho absoluto (pasta ou arquivo) de um mod já escaneado, considerando
 * se está ativo ou desabilitado. Usado pra "Abrir pasta" e outras ações pontuais.
 */
export function resolveModPath(sptPath: string, mod: Pick<ModInfo, "id" | "type" | "enabled">): string {
  const isServer = mod.type === "server";
  const dir = p(
    sptPath,
    mod.enabled ? (isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR) : isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR
  );
  return path.join(dir, mod.id);
}
const SERVER_EXE_CANDIDATES = ["SPT.Server.exe", "Aki.Server.exe"];
const CLIENT_EXE_CANDIDATES = ["EscapeFromTarkov.exe"];

export function validateSptPath(sptPath: string): { valid: boolean; reason?: string } {
  if (!fs.existsSync(sptPath)) {
    return { valid: false, reason: "Pasta não existe." };
  }
  if (!fs.statSync(sptPath).isDirectory()) {
    return { valid: false, reason: "O caminho selecionado não é uma pasta." };
  }

  const hasServerExe = SERVER_EXE_CANDIDATES.some((exe) => fs.existsSync(path.join(sptPath, exe)));
  const hasClientExe = CLIENT_EXE_CANDIDATES.some((exe) => fs.existsSync(path.join(sptPath, exe)));
  const hasUserFolder = fs.existsSync(path.join(sptPath, "user"));
  const hasBepInEx = fs.existsSync(path.join(sptPath, "BepInEx"));

  // Válida se achar qualquer marcador forte (exe conhecido) OU a combinação das duas pastas típicas.
  const valid = hasServerExe || hasClientExe || (hasUserFolder && hasBepInEx);

  if (!valid) {
    return {
      valid: false,
      reason:
        "Não parece ser uma instância SPT válida. Esperava encontrar SPT.Server.exe, EscapeFromTarkov.exe, ou as pastas user/ e BepInEx/ juntas."
    };
  }
  return { valid: true };
}

/**
 * Se a pasta escolhida não for válida, tenta achar a instância automaticamente numa
 * subpasta direta (cobre o caso comum de selecionar a pasta pai, tipo "Desktop", em vez
 * de entrar e escolher a pasta "SPT" em si).
 */
export function resolveSptPath(chosenPath: string): { path: string; autoDetected: boolean } | null {
  const direct = validateSptPath(chosenPath);
  if (direct.valid) return { path: chosenPath, autoDetected: false };

  if (!fs.existsSync(chosenPath)) return null;

  const subEntries = fs.readdirSync(chosenPath, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of subEntries) {
    const candidate = path.join(chosenPath, entry.name);
    if (validateSptPath(candidate).valid) {
      return { path: candidate, autoDetected: true };
    }
  }
  return null;
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

// --- Aliases (nome de exibição customizado, não mexe em arquivo nenhum) ---
function getAliasesPath(sptPath: string): string {
  return path.join(sptPath, ".spt-mod-manager-aliases.json");
}

function loadAliases(sptPath: string): Record<string, string> {
  const aliasPath = getAliasesPath(sptPath);
  if (!fs.existsSync(aliasPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(aliasPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveAliases(sptPath: string, aliases: Record<string, string>) {
  fs.writeFileSync(getAliasesPath(sptPath), JSON.stringify(aliases, null, 2), "utf-8");
}

export function setModAlias(sptPath: string, modId: string, alias: string): { success: boolean; message: string } {
  const aliases = loadAliases(sptPath);
  const trimmed = alias.trim();
  if (trimmed.length === 0) {
    delete aliases[modId];
    saveAliases(sptPath, aliases);
    return { success: true, message: "Nome restaurado pro original." };
  }
  aliases[modId] = trimmed;
  saveAliases(sptPath, aliases);
  return { success: true, message: "Nome atualizado." };
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
/**
 * Monta os dados de export da lista de mods atual — reaproveita o scanMods, então
 * reflete exatamente o que a UI mostra (nome original, tipo, status, versão/autor quando há).
 */
export function exportModListData(sptPath: string) {
  const mods = scanMods(sptPath);
  return {
    exportedAt: new Date().toISOString(),
    mods: mods.map((m) => ({
      name: m.originalName,
      type: m.type,
      enabled: m.enabled,
      version: m.version,
      author: m.author
    }))
  };
}

/**
 * Compara uma lista de nomes de mods importada (de um export anterior, seu ou de outra
 * pessoa) contra o que está instalado agora. Não instala nada automaticamente — a gente
 * não guarda os arquivos originais dos mods, então o mais honesto é mostrar a diferença
 * pra você decidir o que reinstalar manualmente.
 */
export function compareModList(sptPath: string, importedNames: string[]): ModListComparison {
  const currentNames = scanMods(sptPath).map((m) => m.originalName);
  const currentSet = new Set(currentNames);
  const importedSet = new Set(importedNames);
  return {
    missing: importedNames.filter((n) => !currentSet.has(n)),
    extra: currentNames.filter((n) => !importedSet.has(n))
  };
}

export function scanMods(sptPath: string): ModInfo[] {
  const registry = loadRegistry(sptPath);
  const registryIds = new Set(registry.map((r) => r.id));
  const aliases = loadAliases(sptPath);
  const mods: ModInfo[] = [];

  function pushMod(id: string, cleanName: string, type: ModType, enabled: boolean, loadOrder: number, modPath?: string) {
    const metadata = modPath ? readModMetadata(modPath) : {};
    const registryEntry = registry.find((r) => r.id === id);
    mods.push({
      id,
      name: aliases[id] ?? cleanName,
      originalName: cleanName,
      type,
      enabled,
      installedManually: !registryIds.has(id),
      loadOrder,
      version: metadata.version,
      author: metadata.author,
      installedAt: registryEntry?.installedAt
    });
  }

  // Server mods (ativos)
  const serverDir = p(sptPath, SERVER_MODS_DIR);
  if (fs.existsSync(serverDir)) {
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      pushMod(entry.name, cleanName, "server", true, order, path.join(serverDir, entry.name));
    }
  }

  // Server mods (desabilitados)
  const serverDisabledDir = p(sptPath, SERVER_MODS_DISABLED_DIR);
  if (fs.existsSync(serverDisabledDir)) {
    for (const entry of fs.readdirSync(serverDisabledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      pushMod(entry.name, cleanName, "server", false, order, path.join(serverDisabledDir, entry.name));
    }
  }

  // Client mods (ativos) — plugins soltos (.dll) ou em subpastas
  const clientDir = p(sptPath, CLIENT_PLUGINS_DIR);
  if (fs.existsSync(clientDir)) {
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", true, 0, path.join(clientDir, entry.name));
      }
    }
  }

  // Client mods (desabilitados)
  const clientDisabledDir = p(sptPath, CLIENT_PLUGINS_DISABLED_DIR);
  if (fs.existsSync(clientDisabledDir)) {
    for (const entry of fs.readdirSync(clientDisabledDir, { withFileTypes: true })) {
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", false, 0, path.join(clientDisabledDir, entry.name));
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

    const mergeRoot = findMergeRoot(tmpExtractDir);

    if (mergeRoot) {
      const mergeEntries = fs.readdirSync(mergeRoot, { withFileTypes: true });
      const hasUserFolder = mergeEntries.some((e) => e.isDirectory() && e.name.toLowerCase() === "user");
      const hasBepInExFolder = mergeEntries.some((e) => e.isDirectory() && e.name.toLowerCase() === "bepinex");

      // Antes de copiar/limpar, anota os nomes das pastas de mod reais que estão vindo
      // (ex: "EpicsAIO" dentro de "user/mods/"), pra registrar cada uma individualmente
      // depois — em vez de perder essa informação assim que a pasta temporária for apagada.
      const serverModNames: string[] = [];
      const clientModNames: string[] = [];
      if (hasUserFolder) {
        const srcModsDir = path.join(mergeRoot, "user", "mods");
        if (fs.existsSync(srcModsDir)) {
          for (const entry of fs.readdirSync(srcModsDir, { withFileTypes: true })) {
            if (entry.isDirectory()) serverModNames.push(entry.name);
          }
        }
      }
      if (hasBepInExFolder) {
        const srcPluginsDir = path.join(mergeRoot, "BepInEx", "plugins");
        if (fs.existsSync(srcPluginsDir)) {
          for (const entry of fs.readdirSync(srcPluginsDir, { withFileTypes: true })) {
            if (entry.isDirectory() || entry.name.endsWith(".dll")) clientModNames.push(entry.name);
          }
        }
      }

      copyRecursive(mergeRoot, sptPath);
      const verification = verifyCopyRecursive(mergeRoot, sptPath);
      if (!verification.ok) {
        cleanup(tmpExtractDir);
        return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
      }
      cleanup(tmpExtractDir);
      const mergedType: ModType = hasUserFolder && hasBepInExFolder ? "hybrid" : hasUserFolder ? "server" : "client";

      for (const name of serverModNames) {
        addToRegistry(sptPath, { id: name, displayName: name, type: "server", installedAt: new Date().toISOString(), source: "archive-install" });
      }
      for (const name of clientModNames) {
        addToRegistry(sptPath, { id: name, displayName: name, type: "client", installedAt: new Date().toISOString(), source: "archive-install" });
      }
      if (serverModNames.length === 0 && clientModNames.length === 0) {
        // Fallback: não achou subpastas nomeadas (ex: arquivos soltos direto em user/ ou BepInEx/) —
        // registra uma entrada genérica só pra não perder o rastro completamente.
        addToRegistry(sptPath, {
          id: "estrutura-mesclada-" + Date.now(),
          displayName: path.parse(archivePath).name,
          type: mergedType,
          installedAt: new Date().toISOString(),
          source: "archive-install"
        });
      }
      return { success: true, message: "Mod instalado e verificado (estrutura completa detectada)." };
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
      const serverDest = path.join(destBase, modId);
      copyRecursive(sourceDir, serverDest);
      const verification = verifyCopyRecursive(sourceDir, serverDest);
      if (!verification.ok) {
        cleanup(tmpExtractDir);
        return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
      }
      type = "server";
    } else if (dllFiles.length > 0) {
      // Client mod: copia pasta (ou soltas) pra BepInEx/plugins
      destBase = p(sptPath, CLIENT_PLUGINS_DIR);
      ensureDir(destBase);
      const rootEntries = fs.readdirSync(tmpExtractDir, { withFileTypes: true });
      const singleDir = rootEntries.length === 1 && rootEntries[0].isDirectory() ? rootEntries[0].name : null;
      if (singleDir) {
        modId = singleDir;
        const clientDest = path.join(destBase, singleDir);
        copyRecursive(path.join(tmpExtractDir, singleDir), clientDest);
        const verification = verifyCopyRecursive(path.join(tmpExtractDir, singleDir), clientDest);
        if (!verification.ok) {
          cleanup(tmpExtractDir);
          return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
        }
      } else {
        modId = path.parse(archivePath).name;
        const clientDest = path.join(destBase, modId);
        copyRecursive(tmpExtractDir, clientDest);
        const verification = verifyCopyRecursive(tmpExtractDir, clientDest);
        if (!verification.ok) {
          cleanup(tmpExtractDir);
          return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
        }
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
    return { success: true, message: `Mod "${modId}" instalado e verificado como ${type === "server" ? "server mod" : "client mod"}.` };
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

/**
 * Alguns mods vêm com uma pasta "embrulho" no topo do zip (ex: "SPT/user/mods/NomeDoMod"
 * em vez de "user/mods/NomeDoMod" direto na raiz — comum quando quem empacotou o mod
 * simplesmente zipou a pasta da própria instância). Isso procura recursivamente (até
 * alguns níveis de profundidade) por uma pasta que tenha "user" e/ou "BepInEx" como
 * filhos diretos, em vez de olhar só o nível mais raso do zip extraído.
 */
function findMergeRoot(dir: string, depth = 0): string | null {
  if (depth > 5) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const hasUser = entries.some((e) => e.isDirectory() && e.name.toLowerCase() === "user");
  const hasBepInEx = entries.some((e) => e.isDirectory() && e.name.toLowerCase() === "bepinex");
  if (hasUser || hasBepInEx) return dir;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findMergeRoot(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Confere, arquivo por arquivo, que tudo que existia em src também existe em dest
 * (mesmo tamanho). Usado pra confirmar que uma instalação realmente terminou com sucesso,
 * em vez de assumir que copyRecursive não falhou silenciosamente.
 */
function verifyCopyRecursive(src: string, dest: string): { ok: boolean; missing?: string } {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const result = verifyCopyRecursive(srcPath, destPath);
      if (!result.ok) return result;
    } else {
      if (!fs.existsSync(destPath)) return { ok: false, missing: destPath };
      if (fs.statSync(srcPath).size !== fs.statSync(destPath).size) {
        return { ok: false, missing: destPath };
      }
    }
  }
  return { ok: true };
}
