import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import Seven from "node-7z";
import { path7za } from "7zip-bin";
import { createExtractorFromFile } from "node-unrar-js";
import { ModInfo, ModType, RegistryEntry, ModListComparison } from "./types";

/**
 * Lê a versão do SPT a partir de SPT_Data/Server/configs/core.json — é o mesmo arquivo
 * que o pipeline oficial do SPT usa pra validar compatibilidade, então é uma fonte confiável.
 * Best-effort: se o arquivo não existir ou o formato mudar numa versão futura, retorna undefined
 * em vez de quebrar o resto do app.
 */
// A estrutura de pastas do SPT varia entre versões e formas de instalar —
// às vezes tem uma pasta "Server" no meio do caminho, às vezes não; às vezes
// tem uma pasta extra com o mesmo nome do SPT (dependendo de como o release
// foi extraído). Em vez de chutar um caminho fixo (e continuar errando pra
// instalações diferentes da nossa), procura o core.json de verdade dentro da
// instância — pulando pastas pesadas (user/mods, BepInEx, database) que não
// têm esse arquivo e só deixariam a busca lenta à toa. A pasta "database"
// também é onde mora um OUTRO core.json (de bots), que não é o que queremos.
function findCoreJson(sptPath: string): any | undefined {
  const IGNORED_DIRS = new Set(["user", "bepinex", "database", "node_modules", ".git"]);
  const MAX_DEPTH = 5;

  function tryReadCore(corePath: string): any | undefined {
    try {
      return JSON.parse(fs.readFileSync(corePath, "utf-8"));
    } catch {
      return undefined;
    }
  }

  function search(dir: string, depth: number): any | undefined {
    if (depth > MAX_DEPTH) return undefined;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === "core.json") {
        const result = tryReadCore(path.join(dir, entry.name));
        if (result) return result;
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name.toLowerCase())) {
        const result = search(path.join(dir, entry.name), depth + 1);
        if (result) return result;
      }
    }
    return undefined;
  }

  return search(sptPath, 0);
}

export function detectSptVersion(sptPath: string): string | undefined {
  const core = findCoreJson(sptPath);
  if (!core) return undefined;
  if (typeof core.sptVersion === "string") return `SPT ${core.sptVersion}`;
  if (typeof core.akiVersion === "string") return `SPT ${core.akiVersion}`;
  // A partir do SPT 4.0, o core.json não guarda mais a versão do SPT em si —
  // só a versão do Tarkov com que ele é compatível. Não é a mesma informação,
  // mas é a melhor pista disponível nesse arquivo, então mostra com o rótulo
  // certo em vez de apresentar como se fosse a versão do SPT.
  if (typeof core.compatibleTarkovVersion === "string") return `Tarkov ${core.compatibleTarkovVersion}`;
  return undefined;
}

// Versão "crua" (sem rótulo, sem fallback pra versão do Tarkov) — pra uso
// funcional, tipo mandar pra API do Forge, que espera um semver de verdade
// (ex: "3.11.5") e não entenderia "Tarkov 0.16.9.40087". Em instalações
// SPT 4.0+ que não expõem mais esse campo, retorna undefined de propósito —
// melhor pedir pro usuário informar do que mandar algo errado pro Forge.
export function detectSptSemver(sptPath: string): string | undefined {
  const core = findCoreJson(sptPath);
  if (!core) return undefined;
  if (typeof core.sptVersion === "string") return core.sptVersion;
  if (typeof core.akiVersion === "string") return core.akiVersion;
  return undefined;
}

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
      const stream = Seven.extractFull(archivePath, destDir, { $bin: resolveUnpackedBinaryPath(path7za) });
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

/**
 * Quando empacotado, o app roda de dentro de um arquivo .asar — mas um binário (.exe)
 * não pode ser executado de dentro do asar, porque ele não existe ali como um arquivo
 * de verdade em disco (é só uma entrada virtual dentro do arquivo empacotado). O
 * electron-builder foi configurado (via "asarUnpack" no package.json) pra copiar o
 * 7za.exe pra fora do asar, numa pasta irmã "app.asar.unpacked" — só que o pacote
 * 7zip-bin calcula o caminho do binário relativo ao seu próprio __dirname, que continua
 * apontando pra dentro do .asar. Essa função corrige isso na hora de spawnar. Em modo
 * dev (sem asar) o caminho não contém ".asar" e a função não faz nada.
 */
function resolveUnpackedBinaryPath(binPath: string): string {
  const asarSegment = `.asar${path.sep}`;
  if (binPath.includes(asarSegment)) {
    return binPath.replace(asarSegment, `.asar.unpacked${path.sep}`);
  }
  return binPath;
}

// --- Pastas relevantes dentro de uma instância SPT ---
const SERVER_MODS_DIR = ["user", "mods"];
const SERVER_MODS_DISABLED_DIR = ["user", "mods.disabled"];
const CLIENT_PLUGINS_DIR = ["BepInEx", "plugins"];
const CLIENT_PLUGINS_DISABLED_DIR = ["BepInEx", "plugins.disabled"];

/**
 * Arquivos/pastas que pertencem ao próprio SPT (não são mods) mas moram dentro de
 * BepInEx/plugins — o mesmo diretório onde os client mods ficam. O scanner do Manager
 * NUNCA pode listar, alternar ou remover essas entradas, nem que o usuário selecione
 * "tudo" e mande remover: fazer isso quebra a instalação inteira da SPT (foi exatamente
 * o que aconteceu removendo "spt/spt-core.dll"). Se a SPT algum dia renomear esses
 * arquivos, o certo é ampliar esta lista — errar pro lado de "não mexer".
 */
const PROTECTED_CLIENT_PLUGIN_NAMES = new Set(["spt", "spt-core.dll"]);

function isProtectedClientEntry(name: string): boolean {
  return PROTECTED_CLIENT_PLUGIN_NAMES.has(name.toLowerCase());
}

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

// --- Manifesto de arquivos "órfãos" (mods hybrid instalados via merge sem pasta nomeada) ---
// Quando um zip/7z/rar traz user/ e/ou BepInEx/ mas os arquivos não caem em nenhuma pasta
// reconhecível (user/mods/<nome> ou BepInEx/plugins/<nome>), a gente rastreia individualmente
// cada arquivo que entrou, pra esse "mod" pelo menos aparecer como uma linha removível na lista
// em vez de virar um registro fantasma que ninguém consegue gerenciar.
function getManifestPath(sptPath: string): string {
  return path.join(sptPath, ".spt-mod-manager-manifest.json");
}

function loadManifest(sptPath: string): Record<string, string[]> {
  const manifestPath = getManifestPath(sptPath);
  if (!fs.existsSync(manifestPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveManifest(sptPath: string, manifest: Record<string, string[]>) {
  fs.writeFileSync(getManifestPath(sptPath), JSON.stringify(manifest, null, 2), "utf-8");
}

function addManifestEntry(sptPath: string, id: string, relativeFiles: string[]) {
  const manifest = loadManifest(sptPath);
  manifest[id] = relativeFiles;
  saveManifest(sptPath, manifest);
}

function removeManifestEntry(sptPath: string, id: string) {
  const manifest = loadManifest(sptPath);
  delete manifest[id];
  saveManifest(sptPath, manifest);
}

/** Lista todo arquivo (recursivo) dentro de baseDir, com caminho relativo usando "/" sempre. */
function listFilesRelative(baseDir: string, currentDir: string = baseDir): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(listFilesRelative(baseDir, full));
    } else {
      results.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
  return results;
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

export interface ConflictReport {
  clientFileConflicts: { fileName: string; mods: string[] }[];
  duplicateServerNames: { declaredName: string; mods: string[] }[];
}

/**
 * Checagem de conflitos best-effort, no nível de arquivo — não é (e não tenta ser) uma análise
 * semântica de "esses dois mods mexem no mesmo item do jogo". O que dá pra detectar com segurança
 * a partir do sistema de arquivos:
 *
 * 1) DLLs com o mesmo nome vindas de mods client DIFERENTES — o BepInEx carrega toda DLL que
 *    achar recursivamente em BepInEx/plugins/, então duas cópias de uma mesma dependência (ou
 *    duas dlls homônimas de mods diferentes) podem colidir em tempo de execução.
 * 2) Mods server com o mesmo "name" declarado no package.json, mas em pastas diferentes — sinal
 *    clássico de "instalei o mesmo mod duas vezes sem perceber" (ex: atualizaram e a pasta antiga
 *    não foi removida).
 */
export function detectConflicts(sptPath: string): ConflictReport {
  const clientFileConflicts: { fileName: string; mods: string[] }[] = [];
  const dllOwners = new Map<string, Set<string>>();

  const clientDir = p(sptPath, CLIENT_PLUGINS_DIR);
  if (fs.existsSync(clientDir)) {
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const dlls = findFilesRecursive(path.join(clientDir, entry.name), ".dll");
        for (const dllPath of dlls) {
          const base = path.basename(dllPath);
          if (!dllOwners.has(base)) dllOwners.set(base, new Set());
          dllOwners.get(base)!.add(entry.name);
        }
      } else if (entry.name.toLowerCase().endsWith(".dll")) {
        if (!dllOwners.has(entry.name)) dllOwners.set(entry.name, new Set());
        dllOwners.get(entry.name)!.add("(solto em BepInEx/plugins)");
      }
    }
  }
  for (const [fileName, owners] of dllOwners) {
    if (owners.size > 1) clientFileConflicts.push({ fileName, mods: [...owners] });
  }

  const duplicateServerNames: { declaredName: string; mods: string[] }[] = [];
  const nameOwners = new Map<string, Set<string>>();
  const serverDir = p(sptPath, SERVER_MODS_DIR);
  if (fs.existsSync(serverDir)) {
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const pkgPath = path.join(serverDir, entry.name, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (typeof pkg.name === "string") {
            if (!nameOwners.has(pkg.name)) nameOwners.set(pkg.name, new Set());
            nameOwners.get(pkg.name)!.add(entry.name);
          }
        }
      } catch {
        // package.json malformado — ignora silenciosamente, não é fatal pra detecção de conflito
      }
    }
  }
  for (const [declaredName, owners] of nameOwners) {
    if (owners.size > 1) duplicateServerNames.push({ declaredName, mods: [...owners] });
  }

  return { clientFileConflicts, duplicateServerNames };
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
      if (isProtectedClientEntry(entry.name)) continue; // core da própria SPT — nunca é um mod
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", true, 0, path.join(clientDir, entry.name));
      }
    }
  }

  // Client mods (desabilitados)
  const clientDisabledDir = p(sptPath, CLIENT_PLUGINS_DISABLED_DIR);
  if (fs.existsSync(clientDisabledDir)) {
    for (const entry of fs.readdirSync(clientDisabledDir, { withFileTypes: true })) {
      if (isProtectedClientEntry(entry.name)) continue; // core da própria SPT — nunca é um mod
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", false, 0, path.join(clientDisabledDir, entry.name));
      }
    }
  }

  // Mods "órfãos" rastreados por manifesto (arquivos sem pasta nomeada própria) — não suportam
  // habilitar/desabilitar, mas aparecem na lista e podem ser removidos de forma limpa.
  const manifest = loadManifest(sptPath);
  for (const [manifestId, files] of Object.entries(manifest)) {
    const stillExists = files.some((relPath) => fs.existsSync(path.join(sptPath, relPath)));
    if (!stillExists) continue; // arquivos já não existem mais (removidos por fora) — não mostra fantasma
    const registryEntry = registry.find((r) => r.id === manifestId);
    mods.push({
      id: manifestId,
      name: aliases[manifestId] ?? registryEntry?.displayName ?? manifestId,
      originalName: registryEntry?.displayName ?? manifestId,
      type: registryEntry?.type ?? "hybrid",
      enabled: true,
      installedManually: false,
      loadOrder: 99,
      installedAt: registryEntry?.installedAt,
      manifestOnly: true
    });
  }

  return mods.sort((a, b) => a.loadOrder - b.loadOrder || a.name.localeCompare(b.name));
}

// --- Instalar mod a partir de um .zip ou .7z ---
export interface InstallResult {
  success: boolean;
  message: string;
  needsConfirmation?: boolean;
  tmpDir?: string;
  rootEntries?: string[];
  archivePath?: string;
}

export async function installModFromArchive(sptPath: string, archivePath: string): Promise<InstallResult> {
  const tmpExtractDir = path.join(sptPath, ".tmp-mod-extract-" + Date.now());
  try {
    ensureDir(tmpExtractDir);
    await extractArchive(archivePath, tmpExtractDir);

    const mergeRoot = findMergeRoot(tmpExtractDir);

    if (mergeRoot) {
      return performMerge(sptPath, mergeRoot, archivePath, tmpExtractDir);
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
      // Estrutura não reconhecida (sem DLL, sem package.json, sem pasta user/BepInEx em
      // nenhum nível). Em vez de rejeitar de cara, devolve o conteúdo da raiz pro usuário
      // decidir — NÃO limpa a pasta temporária aqui, pra reaproveitar a mesma extração se
      // ele escolher continuar, em vez de precisar selecionar o arquivo de novo.
      const rootEntries = fs
        .readdirSync(tmpExtractDir, { withFileTypes: true })
        .map((e) => e.name + (e.isDirectory() ? "/" : ""));
      return {
        success: false,
        needsConfirmation: true,
        tmpDir: tmpExtractDir,
        rootEntries,
        archivePath,
        message: "Estrutura de arquivo incomum: não encontrei DLL, package.json nem pasta user/BepInEx."
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

/**
 * Copia o conteúdo de `mergeRoot` (uma pasta que já tem "user/" e/ou "BepInEx/" dentro,
 * seja porque foi auto-detectada, seja porque o usuário confirmou uma estrutura incomum)
 * direto pra raiz da instância SPT, registra cada mod encontrado individualmente, e
 * rastreia qualquer arquivo "solto" por manifesto. Compartilhada entre o fluxo normal de
 * instalação e a confirmação manual de estrutura incomum.
 */
function performMerge(sptPath: string, mergeRoot: string, archivePath: string, tmpExtractDir: string): InstallResult {
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
        if (isProtectedClientEntry(entry.name)) continue; // nunca registra o core da própria SPT como mod
        if (entry.isDirectory() || entry.name.endsWith(".dll")) clientModNames.push(entry.name);
      }
    }
  }

  // Qualquer arquivo que não caia dentro de uma dessas pastas nomeadas é "órfão" —
  // ex: algo solto direto em user/ ou BepInEx/ fora de mods/plugins. Rastreamos esses
  // caminhos num manifesto antes de apagar a pasta temporária, pra não perder o rastro.
  const allCopiedFiles = listFilesRelative(mergeRoot);
  const attributedPrefixes = [
    ...serverModNames.map((name) => `user/mods/${name}/`),
    ...clientModNames.map((name) => `BepInEx/plugins/${name}/`)
  ];
  const attributedExactFiles = new Set(clientModNames.map((name) => `BepInEx/plugins/${name}`));
  const orphanFiles = allCopiedFiles.filter(
    (f) => !attributedExactFiles.has(f) && !attributedPrefixes.some((prefix) => f.startsWith(prefix))
  );

  copyRecursive(mergeRoot, sptPath);
  const verification = verifyCopyRecursive(mergeRoot, sptPath);
  if (!verification.ok) {
    cleanup(tmpExtractDir);
    return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
  }
  cleanup(tmpExtractDir);
  const mergedType: ModType = hasUserFolder && hasBepInExFolder ? "hybrid" : hasUserFolder ? "server" : hasBepInExFolder ? "client" : "unknown";

  for (const name of serverModNames) {
    addToRegistry(sptPath, { id: name, displayName: name, type: "server", installedAt: new Date().toISOString(), source: "archive-install" });
  }
  for (const name of clientModNames) {
    addToRegistry(sptPath, { id: name, displayName: name, type: "client", installedAt: new Date().toISOString(), source: "archive-install" });
  }
  if (orphanFiles.length > 0) {
    // Registra como um mod "órfão" rastreado por manifesto — não tem pasta própria pra
    // habilitar/desabilitar, mas pelo menos aparece na lista e pode ser removido de forma limpa.
    const orphanId = "hybrid-manifest-" + Date.now();
    addManifestEntry(sptPath, orphanId, orphanFiles);
    addToRegistry(sptPath, {
      id: orphanId,
      displayName: path.parse(archivePath).name,
      type: mergedType,
      installedAt: new Date().toISOString(),
      source: "archive-install"
    });
  }
  return { success: true, message: "Mod instalado e verificado (estrutura completa detectada)." };
}

/**
 * Só aceita operar em pastas que o próprio Manager criou pra extração temporária desta
 * instância — nunca um caminho arbitrário vindo do processo renderer, que não é
 * totalmente confiável pra apagar ou mesclar coisas direto na instância SPT.
 */
function isOwnTempExtractDir(sptPath: string, tmpDir: string): boolean {
  const resolved = path.resolve(tmpDir);
  const expectedParent = path.resolve(sptPath);
  return path.dirname(resolved) === expectedParent && path.basename(resolved).startsWith(".tmp-mod-extract-");
}

// Usada quando o usuário revisa uma estrutura de arquivo incomum e escolhe "Continuar
// mesmo assim" — reaproveita a extração já feita (sem baixar/extrair de novo) e força a
// mesclagem direto na raiz da instância SPT.
export function finalizeUnrecognizedInstall(sptPath: string, tmpDir: string, archivePath: string): InstallResult {
  if (!isOwnTempExtractDir(sptPath, tmpDir)) {
    return { success: false, message: "Caminho temporário inválido." };
  }
  if (!fs.existsSync(tmpDir)) {
    return { success: false, message: "A extração temporária não existe mais — tente instalar o arquivo de novo." };
  }
  return performMerge(sptPath, tmpDir, archivePath, tmpDir);
}

// Usada quando o usuário aborta depois de revisar uma estrutura de arquivo incomum.
export function discardPendingInstall(sptPath: string, tmpDir: string): { success: boolean; message: string } {
  if (!isOwnTempExtractDir(sptPath, tmpDir)) {
    return { success: false, message: "Caminho temporário inválido." };
  }
  cleanup(tmpDir);
  return { success: true, message: "Instalação cancelada." };
}

// --- Habilitar/desabilitar (move entre pasta ativa e .disabled) ---
export function toggleMod(sptPath: string, mod: ModInfo): { success: boolean; message: string } {
  if (mod.type === "client" && isProtectedClientEntry(mod.id)) {
    return { success: false, message: "Esse item é um arquivo do próprio SPT (não é um mod) e não pode ser alternado." };
  }

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
  if (mod.type === "client" && isProtectedClientEntry(mod.id)) {
    return { success: false, message: "Esse item é um arquivo do próprio SPT (não é um mod) e não pode ser removido pelo Manager." };
  }

  // Mods "órfãos" (manifestOnly) não têm uma pasta própria com o nome do mod —
  // são arquivos soltos rastreados individualmente no manifesto. Precisa apagar
  // cada arquivo listado, em vez de tentar achar uma pasta chamada `mod.id`.
  if (mod.manifestOnly) {
    const manifest = loadManifest(sptPath);
    const files = manifest[mod.id];
    if (!files || files.length === 0) {
      // Registro já estava vazio/inconsistente — ainda assim limpa a entrada
      // da lista pra não deixar um fantasma que ninguém consegue remover.
      removeManifestEntry(sptPath, mod.id);
      removeFromRegistry(sptPath, mod.id);
      return { success: true, message: "Entrada removida da lista (nenhum arquivo rastreado)." };
    }
    let removedCount = 0;
    for (const relPath of files) {
      const target = path.join(sptPath, relPath);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        removedCount++;
      }
    }
    removeManifestEntry(sptPath, mod.id);
    removeFromRegistry(sptPath, mod.id);
    return { success: true, message: `${removedCount} arquivo(s) órfão(s) removido(s).` };
  }

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

/* ==========================================================================
 * Integração com a API da Forge (forge.sp-tarkov.com) — plataforma oficial
 * de mods do SPT. API pública, só leitura, sem chave necessária. Limite de
 * uso: 40 requisições/10s em rajada, 200/60s sustentado — por isso as
 * buscas de nome abaixo são feitas uma de cada vez com um intervalo entre
 * elas, em vez de disparar tudo de uma vez.
 * ========================================================================== */

const FORGE_API_BASE = "https://forge.sp-tarkov.com/api/v0";

export interface ForgeUpdateItem {
  name: string;
  currentVersion?: string;
  recommendedVersion?: string;
  downloadLink?: string;
  reason?: string;
}

export interface ForgeUpdateCheckResult {
  sptVersionUsed: string;
  updates: ForgeUpdateItem[];
  blocked: ForgeUpdateItem[];
  upToDate: ForgeUpdateItem[];
  incompatible: ForgeUpdateItem[];
  infoOnly: ForgeUpdateItem[];
  unmatched: string[];
}

export interface ForgeSptVersion {
  version: string;
  modCount: number;
}

// Lista de versões do SPT que a própria Forge conhece — usada pra montar um
// seletor em vez de depender de digitação livre (evita erro de digitação e
// versão inválida).
export async function getForgeSptVersions(): Promise<ForgeSptVersion[]> {
  // A API não aceita version_major/minor/patch como parâmetro de ORDENAÇÃO
  // (só como campo de dado) — pediria "3.9.0" depois de "3.10.0" se a gente
  // ordenasse pela string "version" (comparação alfabética, não numérica).
  // Pede os números separados e ordena certinho aqui mesmo.
  const url = `${FORGE_API_BASE}/spt/versions?per_page=50&fields=version,mod_count,version_major,version_minor,version_patch`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: any = await res.json();
    const list = (json?.data || []).map((v: any) => ({
      version: v.version as string,
      modCount: v.mod_count as number,
      major: v.version_major ?? 0,
      minor: v.version_minor ?? 0,
      patch: v.version_patch ?? 0
    }));
    list.sort((a: any, b: any) => b.major - a.major || b.minor - a.minor || b.patch - a.patch);
    return list.map(({ version, modCount }: any) => ({ version, modCount }));
  } catch {
    return [];
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A gente só guarda o NOME do mod localmente, não um ID/GUID da Forge — então
// achar o mod certo lá é por busca de nome (heurística). Funciona bem pra
// nomes específicos, pode errar em casos raros de nome genérico/duplicado.
// Já traz a versão mais recente conhecida junto (via include=versions), numa
// chamada só — útil pra mods sem versão local legível (ex: mods puramente
// .dll sem package.json, tipo o SVM), onde não dá pra comparar mas ainda dá
// pra mostrar "essa é a versão mais recente que a Forge conhece".
async function findForgeModInfo(name: string): Promise<{ identifier: string; latestVersion?: string } | null> {
  try {
    const url = `${FORGE_API_BASE}/mods?filter[name]=${encodeURIComponent(name)}&per_page=1&include=versions&fields=id,guid,name`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json: any = await res.json();
    const match = json?.data?.[0];
    if (!match) return null;
    const identifier = typeof match.guid === "string" ? match.guid : String(match.id);
    const latestVersion = Array.isArray(match.versions) && match.versions.length > 0 ? match.versions[0]?.version : undefined;
    return { identifier, latestVersion };
  } catch {
    return null;
  }
}

export async function checkForgeUpdates(
  mods: { name: string; originalName: string; version?: string }[],
  sptVersion: string
): Promise<ForgeUpdateCheckResult> {
  const trimmedVersion = sptVersion.trim();
  if (!trimmedVersion) {
    throw new Error("Informe a versão do SPT antes de verificar atualizações.");
  }

  const pairs: string[] = [];
  const nameByIdentifier = new Map<string, string>();
  const unmatched: string[] = [];
  const infoOnly: ForgeUpdateItem[] = [];

  for (const mod of mods) {
    // Busca pelo nome ORIGINAL (da pasta), não pelo apelido que o usuário deu —
    // assim renomear um mod pra exibição nunca quebra o casamento com a Forge.
    const info = await findForgeModInfo(mod.originalName);
    if (!info) {
      unmatched.push(mod.name);
      await delay(200);
      continue;
    }
    if (mod.version) {
      // Tem versão local — entra na comparação de verdade contra o Forge.
      pairs.push(`${info.identifier}:${mod.version}`);
      nameByIdentifier.set(info.identifier, mod.name);
    } else if (info.latestVersion) {
      // Sem versão local pra comparar (ex: mod só de .dll, sem package.json) —
      // mostra a versão mais recente conhecida como informação, sem alegar
      // que é "atualização disponível" já que não sabemos a versão instalada.
      infoOnly.push({ name: mod.name, recommendedVersion: info.latestVersion, reason: "no_local_version" });
    } else {
      unmatched.push(mod.name);
    }
    await delay(200);
  }

  const empty: ForgeUpdateCheckResult = {
    sptVersionUsed: trimmedVersion,
    updates: [],
    blocked: [],
    upToDate: [],
    incompatible: [],
    infoOnly,
    unmatched
  };
  if (pairs.length === 0) return empty;

  const url = `${FORGE_API_BASE}/mods/updates?mods=${encodeURIComponent(pairs.join(","))}&spt_version=${encodeURIComponent(trimmedVersion)}`;
  let json: any;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    json = await res.json();
    if (!res.ok || json?.success === false) {
      throw new Error(json?.message || `Forge respondeu ${res.status}`);
    }
  } catch (err: any) {
    throw new Error(`Não foi possível consultar o Forge: ${err.message || err}`);
  }

  const data = json.data || {};
  const nameFor = (guid: string, fallback?: string) => nameByIdentifier.get(guid) || fallback || guid;

  return {
    sptVersionUsed: data.spt_version || trimmedVersion,
    updates: (data.updates || []).map((u: any) => ({
      name: nameFor(u.current_version?.guid, u.current_version?.name),
      currentVersion: u.current_version?.version,
      recommendedVersion: u.recommended_version?.version,
      downloadLink: u.recommended_version?.link,
      reason: u.update_reason
    })),
    blocked: (data.blocked_updates || []).map((b: any) => ({
      name: nameFor(b.current_version?.guid, b.current_version?.name),
      currentVersion: b.current_version?.version,
      recommendedVersion: b.latest_version?.version,
      reason: b.block_reason
    })),
    upToDate: (data.up_to_date || []).map((u: any) => ({
      name: nameFor(u.guid, u.name),
      currentVersion: u.version,
      reason: "up_to_date"
    })),
    incompatible: (data.incompatible_with_spt || []).map((i: any) => ({
      name: nameFor(i.guid, i.name),
      currentVersion: i.version,
      reason: i.reason
    })),
    infoOnly,
    unmatched
  };
}

/* ==========================================================================
 * Busca/navegação de mods no catálogo da Forge + instalação em um clique.
 * Diferente do checkForgeUpdates acima (que compara mods JÁ instalados),
 * essa parte deixa o usuário descobrir mods novos direto no app, sem abrir
 * o navegador.
 * ========================================================================== */

export interface ForgeCatalogVersion {
  id: number;
  version: string;
  sptConstraint?: string;
  link: string;
  downloads: number;
  contentLength?: number;
}

export interface ForgeCatalogMod {
  id: number;
  guid: string;
  name: string;
  slug: string;
  teaser?: string;
  thumbnail?: string;
  downloads: number;
  author?: string;
  category?: string;
  fikaCompatible?: boolean;
  detailUrl?: string;
  versions: ForgeCatalogVersion[];
}

export interface ForgeSearchResult {
  mods: ForgeCatalogMod[];
  page: number;
  lastPage: number;
  total: number;
}

export interface ForgeCategory {
  id: number;
  title: string;
  slug: string;
}

function mapCatalogMod(m: any): ForgeCatalogMod {
  return {
    id: m.id,
    guid: m.guid,
    name: m.name,
    slug: m.slug,
    teaser: m.teaser || undefined,
    thumbnail: m.thumbnail || undefined,
    downloads: m.downloads ?? 0,
    author: m.owner?.name,
    category: m.category?.name,
    fikaCompatible: typeof m.fika_compatibility === "boolean" ? m.fika_compatibility : undefined,
    detailUrl: m.detail_url,
    versions: Array.isArray(m.versions)
      ? m.versions.map((v: any) => ({
          id: v.id,
          version: v.version,
          sptConstraint: v.spt_version_constraint || undefined,
          link: v.link,
          downloads: v.downloads ?? 0,
          contentLength: v.content_length ?? undefined
        }))
      : []
  };
}

// Busca paginada no catálogo da Forge. `query` usa a busca full-text deles
// (Meilisearch, nome/slug/descrição); `sptVersionConstraint` é opcional e
// filtra por compatibilidade (a própria Forge avisa que isso filtra o MOD,
// não necessariamente cada versão individual — por isso ainda mostramos a
// lista de versões recentes de cada mod pro usuário escolher).
export async function searchForgeMods(params: {
  query?: string;
  categorySlug?: string;
  sptVersionConstraint?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}): Promise<ForgeSearchResult> {
  const url = new URL(`${FORGE_API_BASE}/mods`);
  url.searchParams.set("include", "category,versions");
  url.searchParams.set("sort", params.sort || "-downloads");
  url.searchParams.set("page", String(params.page || 1));
  url.searchParams.set("per_page", String(params.perPage || 24));
  if (params.query) url.searchParams.set("query", params.query);
  if (params.categorySlug) url.searchParams.set("filter[category_slug]", params.categorySlug);
  if (params.sptVersionConstraint) url.searchParams.set("filter[spt_version]", params.sptVersionConstraint);

  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  const json: any = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Forge respondeu ${res.status}`);
  }

  return {
    mods: (json.data || []).map(mapCatalogMod),
    page: json.meta?.current_page ?? 1,
    lastPage: json.meta?.last_page ?? 1,
    total: json.meta?.total ?? (json.data || []).length
  };
}

export async function getForgeCategories(): Promise<ForgeCategory[]> {
  const url = `${FORGE_API_BASE}/mod-categories?per_page=100&fields=id,title,slug`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json: any = await res.json();
    return (json?.data || []).map((c: any) => ({ id: c.id, title: c.title, slug: c.slug }));
  } catch {
    return [];
  }
}

// Baixa o arquivo de uma versão de mod da Forge pra uma pasta temporária e
// reaproveita installModFromArchive (mesmo caminho de instalação usado pra
// arquivos escolhidos manualmente). O nome/extensão do arquivo é resolvido
// pelo Content-Disposition quando presente; senão, pela URL; senão, assume
// .zip (formato mais comum na Forge).
export async function installForgeModVersion(
  sptPath: string,
  downloadLink: string,
  suggestedName: string
): Promise<InstallResult> {
  let tmpFilePath: string | undefined;
  try {
    const res = await fetch(downloadLink);
    if (!res.ok) {
      return { success: false, message: `Não foi possível baixar o mod da Forge (HTTP ${res.status}).` };
    }

    let ext = ".zip";
    const disposition = res.headers.get("content-disposition");
    const dispositionMatch = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    const dispositionName = dispositionMatch ? decodeURIComponent(dispositionMatch[1]) : undefined;
    const nameToInspect = dispositionName || new URL(downloadLink).pathname;
    const inferredExt = path.extname(nameToInspect).toLowerCase();
    if (inferredExt === ".zip" || inferredExt === ".7z" || inferredExt === ".rar") {
      ext = inferredExt;
    }

    const safeName = suggestedName.replace(/[^a-z0-9._-]/gi, "_").slice(0, 60) || "forge-mod";
    tmpFilePath = path.join(sptPath, `.tmp-forge-download-${Date.now()}-${safeName}${ext}`);

    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(tmpFilePath, Buffer.from(arrayBuffer));

    return await installModFromArchive(sptPath, tmpFilePath);
  } catch (err: any) {
    return { success: false, message: `Falha ao baixar/instalar da Forge: ${err.message || err}` };
  } finally {
    if (tmpFilePath && fs.existsSync(tmpFilePath)) {
      try {
        fs.unlinkSync(tmpFilePath);
      } catch {
        // best-effort — não trava a instalação por causa da limpeza do tmp
      }
    }
  }
}