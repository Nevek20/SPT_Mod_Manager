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
// Detecta entrada de arquivo tentando escapar da pasta de destino ("zip slip") — ex:
// uma entrada chamada "../../../Windows/System32/evil.dll", ou um caminho absoluto tipo
// "C:\Windows\evil.dll". Normaliza barra invertida pra barra normal antes de checar, pra
// pegar os dois estilos de caminho independente de qual SO gerou o arquivo.
function isDangerousEntryPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return true;
  return normalized.split("/").some((segment) => segment === "..");
}

/**
 * Confere a lista de entradas de um arquivo ANTES de extrair de verdade — nunca depois.
 * Um mod malicioso (ou um arquivo corrompido/adulterado) poderia, em tese, tentar gravar
 * fora da pasta temporária de extração. .zip já vem protegido pela própria lib (AdmZip
 * normaliza e trava cada caminho dentro do destino). Pra .7z e .rar, que não têm essa
 * garantia embutida confirmada, listamos as entradas sem extrair e recusamos o arquivo
 * inteiro se achar qualquer uma suspeita — melhor rejeitar tudo do que extrair parcial ou
 * tentar "consertar" nomes de arquivo sozinho.
 */
async function validateArchiveEntries(archivePath: string): Promise<void> {
  const ext = path.extname(archivePath).toLowerCase();

  // .zip grande é extraído pelo 7za (ver extractArchive), então perde a sanitização
  // do AdmZip — precisa passar pela mesma validação de entradas do .7z.
  const zipHandledBySevenZip =
    ext === ".zip" && fs.existsSync(archivePath) && fs.statSync(archivePath).size >= LARGE_ARCHIVE_THRESHOLD_BYTES;

  if (ext === ".7z" || zipHandledBySevenZip) {
    const entries: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = Seven.list(archivePath, { $bin: resolveUnpackedBinaryPath(path7za) });
      stream.on("data", (data: any) => {
        if (data?.file) entries.push(data.file);
      });
      stream.on("end", () => resolve());
      stream.on("error", (err: Error) => reject(err));
    });
    const dangerous = entries.find(isDangerousEntryPath);
    if (dangerous) {
      throw new Error(`Arquivo rejeitado por segurança: entrada suspeita no ${ext} ("${dangerous}").`);
    }
    return;
  }

  if (ext === ".rar") {
    const extractor = await createExtractorFromFile({ filepath: archivePath });
    const { fileHeaders } = extractor.getFileList();
    for (const header of fileHeaders) {
      if (isDangerousEntryPath(header.name)) {
        throw new Error(`Arquivo rejeitado por segurança: entrada suspeita no .rar ("${header.name}").`);
      }
    }
    return;
  }

  // .zip: a própria AdmZip já sanitiza cada caminho contra o destino antes de gravar
  // (confirmado na versão instalada) — não precisa de checagem adicional aqui.
}

// Acima disso o AdmZip não dá conta (limite de 2 GiB de buffer do Node); a margem
// evita chegar perto do teto por causa de overhead interno.
const LARGE_ARCHIVE_THRESHOLD_BYTES = 1_500_000_000;

function extractWithSevenZip(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, destDir, { $bin: resolveUnpackedBinaryPath(path7za) });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const ext = path.extname(archivePath).toLowerCase();
  await validateArchiveEntries(archivePath);

  if (ext === ".zip") {
    // AdmZip carrega o arquivo inteiro na memória (readFileSync), e o Node recusa
    // buffer acima de 2 GiB — mods de conteúdo passam disso com folga. Acima do
    // limite usamos o 7za, que também abre .zip e trabalha em streaming.
    if (fs.statSync(archivePath).size >= LARGE_ARCHIVE_THRESHOLD_BYTES) {
      return extractWithSevenZip(archivePath, destDir);
    }
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destDir, true);
    return;
  }

  if (ext === ".7z") {
    return extractWithSevenZip(archivePath, destDir);
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
// Prepatchers rodam ANTES do jogo carregar e ficam fora de plugins/. Um mod pode ter as
// duas partes (ex: Wedge traz Wedge.Client.dll em plugins/ e Wedge.Prepatch.dll em
// patchers/), e desabilitar só o plugin deixava o patcher ativo — pior que não desabilitar,
// porque o mod fica meio ligado.
const CLIENT_PATCHERS_DIR = ["BepInEx", "patchers"];
const CLIENT_PATCHERS_DISABLED_DIR = ["BepInEx", "patchers.disabled"];

/**
 * Arquivos/pastas que pertencem ao próprio SPT (não são mods) mas moram dentro de
 * BepInEx/plugins — o mesmo diretório onde os client mods ficam. O scanner do Manager
 * NUNCA pode listar, alternar ou remover essas entradas, nem que o usuário selecione
 * "tudo" e mande remover: fazer isso quebra a instalação inteira da SPT (foi exatamente
 * o que aconteceu removendo "spt/spt-core.dll"). Se a SPT algum dia renomear esses
 * arquivos, o certo é ampliar esta lista — errar pro lado de "não mexer".
 */
const PROTECTED_CLIENT_PLUGIN_NAMES = new Set(["spt", "spt-core.dll"]);

/**
 * Muitos client mods se instalam como "plugins/Mod.dll" + "plugins/Mod/" (a pasta com
 * config, assets, etc). A pasta não é um mod — é dado do plugin. Sem isso, ela aparecia
 * como uma segunda entrada com o mesmo nome e sem metadado nenhum, poluindo a lista e
 * a modlist exportada.
 */
function listCompanionFolderNames(dir: string): Set<string> {
  if (!fs.existsSync(dir)) return new Set();
  const looseDllBases = new Set<string>();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".dll")) {
      looseDllBases.add(entry.name.slice(0, -4).toLowerCase());
    }
  }
  return looseDllBases;
}

/**
 * Arquivos em BepInEx/patchers que pertencem a um mod client.
 *
 * Duas fontes, nessa ordem:
 *  1. o manifesto — quando o mod foi instalado pelo app, sabemos exatamente quais
 *     arquivos vieram com ele;
 *  2. o nome — pra mods instalados por fora, um patcher costuma se chamar
 *     "<NomeDoMod>.Prepatch.dll", "<NomeDoMod>.Patcher.dll" ou só "<NomeDoMod>.dll".
 *
 * A regra por nome exige limite de palavra: "Wedge" casa com "Wedge.Prepatch.dll", mas
 * NÃO com "WedgeExtras.dll" — mover o patcher de outro mod quebraria esse outro mod.
 */
function findRelatedPatcherFiles(dir: string, modId: string, manifestFiles: string[] = []): string[] {
  if (!fs.existsSync(dir)) return [];
  const modBase = modId.replace(/\.dll$/i, "").toLowerCase();
  if (!modBase) return [];

  const fromManifest = new Set(
    manifestFiles
      .filter((f) => f.toLowerCase().includes("bepinex/patchers/"))
      .map((f) => path.basename(f).toLowerCase())
  );

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      const lower = entry.name.toLowerCase();
      if (fromManifest.has(lower)) return true;
      const base = lower.replace(/\.dll$/i, "");
      if (base === modBase) return true;
      // limite de palavra: o caractere logo após o nome do mod não pode ser letra/número
      return base.startsWith(modBase) && !/[a-z0-9]/.test(base.charAt(modBase.length));
    })
    .map((entry) => path.join(dir, entry.name));
}

function isProtectedClientEntry(name: string): boolean {
  return PROTECTED_CLIENT_PLUGIN_NAMES.has(name.toLowerCase());
}

/**
 * Um caminho relativo (dentro do arquivo do mod) que cairia em cima do núcleo do client
 * da SPT — "BepInEx/plugins/spt/..." ou "BepInEx/plugins/spt-core.dll".
 *
 * Alguns mods empacotam a árvore inteira da SPT junto, incluindo uma cópia (geralmente
 * mais antiga) desses arquivos. Sem essa checagem, instalar um mod desses sobrescrevia o
 * core do usuário e o jogo passava a acusar
 * "spt-core.dll file version doesn't match what was expected".
 *
 * Isso é diferente da proteção que já existia: aquela impede LISTAR e REMOVER o core;
 * esta impede SOBRESCREVER durante a instalação.
 */
function isProtectedInstancePath(relPath: string): boolean {
  const parts = relPath.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  const pluginsAt = parts.findIndex((seg, i) => seg === "plugins" && parts[i - 1] === "bepinex");
  if (pluginsAt === -1) return false;
  const next = parts[pluginsAt + 1];
  return next !== undefined && PROTECTED_CLIENT_PLUGIN_NAMES.has(next);
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
/* --------------------------------------------------------------------------
 * Leitura de metadados do mod.
 *
 * Mods do SPT 3.x traziam package.json com name/version/author. No SPT 4.0 os
 * mods viraram assemblies .NET e essa informação passou a morar DENTRO da DLL,
 * na classe de metadados do mod (ModMetadata / BepInPlugin), gravada como
 * strings UTF-16 no assembly:
 *
 *   "com.toha3673.unbreakablekeys"  <- GUID
 *   "Unbreakable Keys"              <- nome
 *   "Toha3673"                      <- autor
 *   "2.0.0"                         <- versão do mod
 *   "~4.0.0"                        <- versão do SPT suportada
 *
 * Importante: NÃO dá pra usar o AssemblyVersion/FileVersion do PE aqui. Num mod
 * real conferido, o assembly dizia 0.0.1.0 enquanto a versão publicada era 2.0.0
 * — o autor simplesmente não versiona o assembly. O valor que vale é o declarado
 * na classe de metadados.
 * ------------------------------------------------------------------------ */

export interface ForgeInstallInfo {
  name?: string;
  author?: string;
  version?: string;
  guid?: string;
}

export interface DllModMetadata {
  guid?: string;
  name?: string;
  author?: string;
  version?: string;
  sptVersion?: string;
}

const DLL_VERSION_RE = /^\d+\.\d+(\.\d+)?(\.\d+)?$/;
const DLL_CONSTRAINT_RE = /^[~^>=<]/;
const DLL_GUID_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+){1,4}$/i;

// Extrai strings UTF-16LE imprimíveis — é assim que o .NET guarda literais de
// código no heap #US, e é onde os metadados do mod acabam.
function extractUtf16Strings(buffer: Buffer, minLen = 3, maxLen = 120): string[] {
  const out: string[] = [];
  let current: number[] = [];
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const lo = buffer[i];
    const printable = buffer[i + 1] === 0 && lo >= 0x20 && lo <= 0x7e;
    if (printable) {
      current.push(lo);
      if (current.length > maxLen) current = [];
    } else {
      if (current.length >= minLen) out.push(Buffer.from(current).toString("latin1"));
      current = [];
    }
  }
  if (current.length >= minLen) out.push(Buffer.from(current).toString("latin1"));
  return out;
}

const DLL_LICENSE_RE = /^(MIT|ISC|Apache|GPL|LGPL|AGPL|BSD|MPL|Unlicense|CC0|WTFPL|Zlib|Proprietary)[-\s0-9.]*$/i;

// Extrai strings ASCII/UTF-8 — é onde ficam os argumentos de atributo (heap #Blob),
// usados pelo BepInPlugin dos client mods.
function extractAsciiStrings(buffer: Buffer, minLen = 3, maxLen = 120): string[] {
  const out: string[] = [];
  let current: number[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte >= 0x20 && byte <= 0x7e) {
      current.push(byte);
      if (current.length > maxLen) current = [];
    } else {
      if (current.length >= minLen) out.push(Buffer.from(current).toString("latin1"));
      current = [];
    }
  }
  if (current.length >= minLen) out.push(Buffer.from(current).toString("latin1"));
  return out;
}

function looksLikeModGuid(value: string): boolean {
  if (!DLL_GUID_RE.test(value)) return false;
  if (/^(system|microsoft|mscorlib|netstandard|newtonsoft|unityengine|bepinex|comfort|eft)\./i.test(value)) return false;
  if (/\.(dll|exe|json|jsonc|md|txt|cs|pdb|png|cfg)$/i.test(value)) return false;
  return true;
}

// Nome plausível de mod — rejeita strings vizinhas que claramente NÃO são nome
// (mensagem de log, campo do VS_VERSION_INFO, caminho, frase).
function looksLikeModName(value: string): boolean {
  if (!value || value.length > 60) return false;
  if (/[[\]{}<>:;/\\|=]/.test(value)) return false;
  if (value.trim().split(/\s+/).length > 6) return false;
  if (/\.(dll|exe|json|jsonc|md|txt|cs|pdb|png|cfg)$/i.test(value)) return false;
  if (/^(InternalName|ProductName|FileDescription|CompanyName|OriginalFilename|LegalCopyright|FileVersion|ProductVersion|Assembly Version|Translation|VarFileInfo|StringFileInfo|VS_VERSION_INFO|ModMetadata|AllowMultiple)$/i.test(value)) return false;
  return /[a-zA-Z]/.test(value);
}

/**
 * Server mod (SPT 4.0): os valores ficam como literais UTF-16, logo depois do
 * marcador "ModMetadata". A ORDEM DOS CAMPOS VARIA de mod pra mod, porque depende
 * de como o autor escreveu o inicializador — conferido em dois mods do mesmo autor:
 *
 *   bosseshavelegamedals: ModMetadata, " { ", GUID, nome, autor, versão, ~spt, MIT
 *   brightlasers:         ModMetadata, " { ", nome, autor, versão, ~spt, MIT, GUID
 *
 * Por isso NÃO dá pra ler por posição fixa a partir do GUID (foi o que fez metade
 * dos mods sair em branco). Ancoramos no marcador "ModMetadata" e classificamos
 * cada string por FORMATO; o que sobra de texto é nome e autor, nessa ordem
 * (consistente nos mods conferidos).
 */
function parseServerModMetadata(utf16: string[]): DllModMetadata | null {
  const anchor = utf16.findIndex((v) => v === "ModMetadata");
  if (anchor === -1) return null;
  const window = utf16.slice(anchor + 1, anchor + 10);

  const guid = window.find(looksLikeModGuid);
  const version = window.find((v) => DLL_VERSION_RE.test(v));
  const sptVersion = window.find((v) => DLL_CONSTRAINT_RE.test(v) && /\d/.test(v));
  const textual = window.filter(
    (v) =>
      // Exclui QUALQUER string com cara de GUID, não só a escolhida — mods com
      // dependência declarada têm mais de uma, e a segunda virava "autor".
      !looksLikeModGuid(v) &&
      !DLL_VERSION_RE.test(v) &&
      !DLL_CONSTRAINT_RE.test(v) &&
      !DLL_LICENSE_RE.test(v) &&
      !/^https?:/i.test(v) &&
      looksLikeModName(v)
  );
  if (!guid && !version) return null;
  return { guid, name: textual[0], author: textual[1], version, sptVersion };
}

/**
 * Client mod (BepInEx): [BepInPlugin(GUID, Nome, Versão)]. Argumentos de atributo
 * são constantes de compilação e ficam no heap #Blob em UTF-8 — NÃO em UTF-16 —,
 * por isso ler só UTF-16 não achava nada nesses mods. Os três valores ficam
 * adjacentes, e o GUID é minúsculo por convenção (o que o distingue dos namespaces
 * PascalCase do próprio assembly, tipo "DrakiaXYZ.BigBrain").
 * Esse formato não tem campo de autor — deixamos vazio em vez de inventar.
 */
function parseClientModMetadata(ascii: string[]): DllModMetadata | null {
  // Coleta TODOS os blocos (guid, nome, versão) plausíveis e fica com o de GUID mais
  // "qualificado" (mais segmentos de domínio invertido).
  //
  // Exigir 3+ segmentos, como antes, servia pra pular um bloco falso que alguns
  // assemblies carregam antes do verdadeiro — mas descartava GUID legítimo de 2
  // segmentos ("Kat.BetterAmmoLoadingList", "Tosox.DynamicItemWeights"), e esses mods
  // ficavam sem versão nenhuma na lista. Escolher o mais qualificado resolve os dois:
  // no IcyClawz, o falso tem 2 segmentos e o real tem 3, então o real ganha.
  const candidates: { meta: DllModMetadata; segments: number }[] = [];
  for (let i = 0; i < ascii.length - 2; i++) {
    const value = ascii[i];
    if (!looksLikeModGuid(value)) continue;
    const name = ascii[i + 1];
    const version = ascii[i + 2];
    if (!looksLikeModName(name) || !DLL_VERSION_RE.test(version)) continue;
    candidates.push({ meta: { guid: value, name, version }, segments: value.split(".").length });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.segments - a.segments);
  return candidates[0].meta;
}

export function parseModMetadataFromStrings(utf16: string[], ascii: string[] = []): DllModMetadata {
  return parseServerModMetadata(utf16) ?? parseClientModMetadata(ascii) ?? {};
}

export function readDllModMetadata(dllPath: string): DllModMetadata {
  try {
    const buffer = fs.readFileSync(dllPath);
    if (buffer.length < 2 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return {}; // não é PE ("MZ")
    return parseModMetadataFromStrings(extractUtf16Strings(buffer), extractAsciiStrings(buffer));
  } catch {
    return {};
  }
}

function readModMetadata(modPath: string): {
  version?: string;
  author?: string;
  guid?: string;
  declaredName?: string;
  sptVersion?: string;
} {
  try {
    if (!fs.existsSync(modPath)) return {};

    // Client mod pode ser uma .dll solta, sem pasta própria.
    if (!fs.statSync(modPath).isDirectory()) {
      if (modPath.toLowerCase().endsWith(".dll")) {
        const meta = readDllModMetadata(modPath);
        return { version: meta.version, author: meta.author, guid: meta.guid, declaredName: meta.name, sptVersion: meta.sptVersion };
      }
      return {};
    }

    // SPT 3.x: package.json continua valendo quando existe.
    const pkgPath = path.join(modPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name;
      if (typeof pkg.version === "string") {
        return { version: pkg.version, author, declaredName: typeof pkg.name === "string" ? pkg.name : undefined };
      }
    }

    // SPT 4.0: metadados dentro da DLL.
    for (const dll of findFilesRecursive(modPath, ".dll")) {
      const meta = readDllModMetadata(dll);
      if (meta.version || meta.guid) {
        return { version: meta.version, author: meta.author, guid: meta.guid, declaredName: meta.name, sptVersion: meta.sptVersion };
      }
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Resolve o caminho absoluto (pasta ou arquivo) de um mod já escaneado, considerando
 * se está ativo ou desabilitado. Usado pra "Abrir pasta" e outras ações pontuais.
 */
export function resolveModPath(
  clientRoot: string,
  serverRoot: string,
  mod: Pick<ModInfo, "id" | "type" | "enabled">
): string {
  const isServer = mod.type === "server";
  const base = isServer ? serverRoot : clientRoot;
  const dir = p(
    base,
    mod.enabled ? (isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR) : isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR
  );
  return path.join(dir, mod.id);
}
const SERVER_EXE_CANDIDATES = ["SPT.Server.exe", "Aki.Server.exe"];
const CLIENT_EXE_CANDIDATES = ["EscapeFromTarkov.exe"];

function hasClientMarkers(dir: string): boolean {
  return CLIENT_EXE_CANDIDATES.some((exe) => fs.existsSync(path.join(dir, exe))) || fs.existsSync(path.join(dir, "BepInEx"));
}

function hasServerMarkers(dir: string): boolean {
  return SERVER_EXE_CANDIDATES.some((exe) => fs.existsSync(path.join(dir, exe))) || fs.existsSync(path.join(dir, "user"));
}

export function validateSptPath(sptPath: string): { valid: boolean; reason?: string } {
  if (!fs.existsSync(sptPath)) {
    return { valid: false, reason: "Pasta não existe." };
  }
  if (!fs.statSync(sptPath).isDirectory()) {
    return { valid: false, reason: "O caminho selecionado não é uma pasta." };
  }

  const valid = hasClientMarkers(sptPath) || hasServerMarkers(sptPath);

  if (!valid) {
    return {
      valid: false,
      reason:
        "Não parece ser uma instância SPT válida. Esperava encontrar SPT.Server.exe, EscapeFromTarkov.exe, ou as pastas user/ e BepInEx/ juntas."
    };
  }
  return { valid: true };
}

export interface SptInstancePaths {
  clientRoot: string; // onde fica BepInEx/ e o executável do jogo
  serverRoot: string; // onde fica SPT.Server.exe e user/ — igual a clientRoot na grande maioria dos casos
  split: boolean; // true quando client e server estão em pastas diferentes
}

/**
 * Descobre onde ficam os arquivos de client (BepInEx/, exe do jogo) e de server
 * (SPT.Server.exe, user/) a partir da pasta escolhida pelo usuário. Na maioria das
 * instalações os dois estão juntos na mesma pasta. Mas o instalador oficial da SPT 4.x
 * pode criar uma estrutura "dividida": o client fica na pasta escolhida, e o server fica
 * numa subpasta (geralmente também chamada "SPT") um nível abaixo. Se isso não for
 * tratado à parte, mods de servidor (user/mods/...) acabam instalados no lugar errado —
 * o server real nem enxerga eles, porque roda de dentro da subpasta.
 */
export function resolveSptInstance(chosenPath: string): { instance: SptInstancePaths; autoDetected: boolean } | null {
  if (!fs.existsSync(chosenPath) || !fs.statSync(chosenPath).isDirectory()) return null;

  const chosenHasClient = hasClientMarkers(chosenPath);
  const chosenHasServer = hasServerMarkers(chosenPath);

  // Caso comum: tudo já está na pasta escolhida.
  if (chosenHasClient && chosenHasServer) {
    return { instance: { clientRoot: chosenPath, serverRoot: chosenPath, split: false }, autoDetected: false };
  }

  let clientRoot = chosenHasClient ? chosenPath : undefined;
  let serverRoot = chosenHasServer ? chosenPath : undefined;

  const subEntries = fs.readdirSync(chosenPath, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const entry of subEntries) {
    const candidate = path.join(chosenPath, entry.name);
    if (!clientRoot && hasClientMarkers(candidate)) clientRoot = candidate;
    if (!serverRoot && hasServerMarkers(candidate)) serverRoot = candidate;
  }

  if (clientRoot && serverRoot) {
    const split = clientRoot !== serverRoot;
    const autoDetected = clientRoot !== chosenPath || serverRoot !== chosenPath;
    return { instance: { clientRoot, serverRoot, split }, autoDetected };
  }

  // Achou só um dos dois (ex: só o client, se o server nunca rodou ainda) — usa o mesmo
  // caminho pros dois, mantendo o comportamento de antes pra esse caso.
  const single = clientRoot || serverRoot;
  if (single) {
    return { instance: { clientRoot: single, serverRoot: single, split: false }, autoDetected: single !== chosenPath };
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
export function exportModListData(clientRoot: string, serverRoot: string) {
  const mods = scanMods(clientRoot, serverRoot);
  return {
    exportedAt: new Date().toISOString(),
    mods: mods.map((m) => ({
      name: m.originalName,
      type: m.type,
      enabled: m.enabled,
      version: m.version,
      author: m.author,
      // O GUID é o que permite restaurar a lista por identificador exato depois, em vez
      // de tentar adivinhar pelo nome da pasta (que quase nunca é igual ao nome na Forge).
      guid: m.guid
    }))
  };
}

/**
 * Compara uma lista de nomes de mods importada (de um export anterior, seu ou de outra
 * pessoa) contra o que está instalado agora. Não instala nada automaticamente — a gente
 * não guarda os arquivos originais dos mods, então o mais honesto é mostrar a diferença
 * pra você decidir o que reinstalar manualmente.
 */
export function compareModList(clientRoot: string, serverRoot: string, importedNames: string[]): ModListComparison {
  const currentNames = scanMods(clientRoot, serverRoot).map((m) => m.originalName);
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
  duplicateClientMods?: { declaredName: string; mods: string[] }[];
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
/**
 * Compara a restrição de versão do SPT declarada pelo mod com a versão da instância.
 *
 * Isso é 100% LOCAL: a informação vem da DLL do próprio mod ("~4.0.0", "4.0.13", "~4.0"),
 * então funciona sem consultar API nenhuma — o que importa muito agora que a Forge vai
 * sair do ar. É a parte mais útil do que a checagem online entregava.
 *
 * Retorna "unknown" quando o mod não declara nada (mods 3.x, ou 4.0 que omitem o campo):
 * nesse caso não dá pra afirmar nada, e afirmar seria pior que ficar calado.
 */
export function checkSptCompatibility(
  modConstraint: string | undefined,
  instanceVersion: string | undefined
): "compatible" | "incompatible" | "unknown" {
  if (!modConstraint?.trim() || !instanceVersion?.trim()) return "unknown";

  const parse = (v: string) =>
    v
      .trim()
      .replace(/^[~^>=<\s]+/, "")
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10))
      .filter((n) => !Number.isNaN(n));

  const wanted = parse(modConstraint);
  const actual = parse(instanceVersion);
  if (wanted.length === 0 || actual.length === 0) return "unknown";

  const operator = modConstraint.trim().startsWith("~")
    ? "tilde"
    : modConstraint.trim().startsWith("^")
      ? "caret"
      : modConstraint.trim().startsWith(">")
        ? "atLeast"
        : "exact";

  // "^4.0" aceita qualquer 4.x; "~4.0.0" aceita qualquer 4.0.x; ">=4.0" aceita daí pra cima.
  if (operator === "atLeast") {
    for (let i = 0; i < Math.max(wanted.length, actual.length); i++) {
      const a = actual[i] ?? 0;
      const w = wanted[i] ?? 0;
      if (a !== w) return a > w ? "compatible" : "incompatible";
    }
    return "compatible";
  }

  const precision = operator === "caret" ? 1 : Math.min(wanted.length, operator === "tilde" ? 2 : wanted.length);
  for (let i = 0; i < precision; i++) {
    if ((actual[i] ?? 0) !== (wanted[i] ?? 0)) return "incompatible";
  }
  return "compatible";
}

export function detectConflicts(clientRoot: string, serverRoot: string): ConflictReport {
  const clientFileConflicts: { fileName: string; mods: string[] }[] = [];
  const dllOwners = new Map<string, Set<string>>();

  const clientDir = p(clientRoot, CLIENT_PLUGINS_DIR);
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
  const serverDir = p(serverRoot, SERVER_MODS_DIR);
  if (fs.existsSync(serverDir)) {
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Identifica o mod pelo GUID declarado (lido da DLL no SPT 4.0) e, na falta dele,
      // pelo "name" do package.json (mods 3.x).
      //
      // Antes isso olhava só o package.json — que mods 4.0 não trazem mais, já que os
      // metadados migraram pra dentro do assembly. Ou seja, a checagem não detectava
      // duplicata nenhuma numa instalação 4.0.
      const metadata = readModMetadata(path.join(serverDir, entry.name));
      const identity = metadata.guid ?? metadata.declaredName;
      if (!identity) continue;
      if (!nameOwners.has(identity)) nameOwners.set(identity, new Set());
      nameOwners.get(identity)!.add(entry.name);
    }
  }
  for (const [declaredName, owners] of nameOwners) {
    if (owners.size > 1) duplicateServerNames.push({ declaredName, mods: [...owners] });
  }

  // Duplicata de CLIENT mod: o mesmo mod instalado em duas pastas diferentes.
  // Detectado pelo GUID do BepInPlugin — nome de pasta não serve, já que a graça é
  // justamente serem nomes diferentes ("SAIN" e "SAIN.4.4.3", por exemplo).
  const duplicateClientMods: { declaredName: string; mods: string[] }[] = [];
  const clientGuidOwners = new Map<string, Set<string>>();
  if (fs.existsSync(clientDir)) {
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (isProtectedClientEntry(entry.name)) continue;
      const meta = readModMetadata(path.join(clientDir, entry.name));
      if (!meta.guid) continue;
      if (!clientGuidOwners.has(meta.guid)) clientGuidOwners.set(meta.guid, new Set());
      clientGuidOwners.get(meta.guid)!.add(entry.name);
    }
  }
  for (const [guid, owners] of clientGuidOwners) {
    if (owners.size > 1) duplicateClientMods.push({ declaredName: guid, mods: [...owners] });
  }

  return { clientFileConflicts, duplicateServerNames, duplicateClientMods };
}

// Resolve o caminho real de um arquivo rastreado por manifesto: tudo que começa com
// "user/" pertence ao lado do servidor (serverRoot); o resto (BepInEx/, ou qualquer
// arquivo solto que sobrou na raiz do mod) pertence ao lado do client (clientRoot).
// Nas instalações não-divididas (o caso comum) clientRoot === serverRoot, então isso
// não muda nada — só importa quando as duas pastas são diferentes de verdade.
function resolveManifestFilePath(clientRoot: string, serverRoot: string, relPath: string): string {
  const base = relPath.toLowerCase().startsWith("user/") ? serverRoot : clientRoot;
  return path.join(base, relPath);
}

export function scanMods(clientRoot: string, serverRoot: string): ModInfo[] {
  const registry = loadRegistry(clientRoot);
  const registryIds = new Set(registry.map((r) => r.id));
  const aliases = loadAliases(clientRoot);
  const mods: ModInfo[] = [];

  // Resolve o nome de exibição de um mod "ligado" (ex: arquivo solto do mesmo install) —
  // usado tanto pra mostrar um indicativo na lista quanto pro diálogo de confirmação antes
  // de remover avisar que o outro também vai junto.
  function resolveLinkedName(linkedModId: string | undefined): string | undefined {
    if (!linkedModId) return undefined;
    const linkedEntry = registry.find((r) => r.id === linkedModId);
    if (!linkedEntry) return undefined;
    return aliases[linkedModId] ?? linkedEntry.displayName;
  }

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
      // Prioridade: o que o próprio mod declara localmente; se faltar, o que a
      // Forge informou quando o mod foi instalado pelo app (fonte confiável —
      // client mods, por exemplo, não têm campo de autor nenhum na DLL).
      version: metadata.version ?? registryEntry?.forgeVersion,
      author: metadata.author ?? registryEntry?.forgeAuthor,
      // O GUID que a PRÓPRIA Forge nos deu na instalação vem primeiro: é o identificador
      // dela, e é o que os filtros da API entendem. O GUID lido da DLL (BepInPlugin) é
      // do runtime do mod e nem sempre é o mesmo — serve de plano B pra quem foi
      // instalado por fora do app.
      guid: registryEntry?.forgeGuid ?? metadata.guid,
      sptVersion: metadata.sptVersion,
      packageId: registryEntry?.packageId,
      installedAt: registryEntry?.installedAt,
      linkedModName: resolveLinkedName(registryEntry?.linkedModId)
    });
  }

  // Server mods (ativos)
  const serverDir = p(serverRoot, SERVER_MODS_DIR);
  if (fs.existsSync(serverDir)) {
    for (const entry of fs.readdirSync(serverDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      pushMod(entry.name, cleanName, "server", true, order, path.join(serverDir, entry.name));
    }
  }

  // Server mods (desabilitados)
  const serverDisabledDir = p(serverRoot, SERVER_MODS_DISABLED_DIR);
  if (fs.existsSync(serverDisabledDir)) {
    for (const entry of fs.readdirSync(serverDisabledDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { order, cleanName } = stripLoadOrderPrefix(entry.name);
      pushMod(entry.name, cleanName, "server", false, order, path.join(serverDisabledDir, entry.name));
    }
  }

  // Client mods (ativos) — plugins soltos (.dll) ou em subpastas
  const clientDir = p(clientRoot, CLIENT_PLUGINS_DIR);
  if (fs.existsSync(clientDir)) {
    const companions = listCompanionFolderNames(clientDir);
    for (const entry of fs.readdirSync(clientDir, { withFileTypes: true })) {
      if (isProtectedClientEntry(entry.name)) continue; // core da própria SPT — nunca é um mod
      // pasta de dados de um .dll solto de mesmo nome: pertence a ele, não é mod à parte
      if (entry.isDirectory() && companions.has(entry.name.toLowerCase())) continue;
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", true, 0, path.join(clientDir, entry.name));
      }
    }
  }

  // Client mods (desabilitados)
  const clientDisabledDir = p(clientRoot, CLIENT_PLUGINS_DISABLED_DIR);
  if (fs.existsSync(clientDisabledDir)) {
    const companions = listCompanionFolderNames(clientDisabledDir);
    for (const entry of fs.readdirSync(clientDisabledDir, { withFileTypes: true })) {
      if (isProtectedClientEntry(entry.name)) continue; // core da própria SPT — nunca é um mod
      // pasta de dados de um .dll solto de mesmo nome: pertence a ele, não é mod à parte
      if (entry.isDirectory() && companions.has(entry.name.toLowerCase())) continue;
      if (entry.name.endsWith(".dll") || entry.isDirectory()) {
        pushMod(entry.name, entry.name.replace(/\.dll$/i, ""), "client", false, 0, path.join(clientDisabledDir, entry.name));
      }
    }
  }

  // Mods "órfãos" rastreados por manifesto (arquivos sem pasta nomeada própria) — não suportam
  // habilitar/desabilitar, mas aparecem na lista e podem ser removidos de forma limpa.
  const manifest = loadManifest(clientRoot);
  // Ids dos mods "de verdade" (com pasta própria) já listados acima.
  const namedModIds = new Set(mods.map((m) => m.id));
  for (const [manifestId, files] of Object.entries(manifest)) {
    const stillExists = files.some((relPath) => fs.existsSync(resolveManifestFilePath(clientRoot, serverRoot, relPath)));
    if (!stillExists) continue; // arquivos já não existem mais (removidos por fora) — não mostra fantasma
    const registryEntry = registry.find((r) => r.id === manifestId);

    // Quando esses arquivos soltos vieram do mesmo arquivo de um único mod nomeado,
    // não são um item separado do ponto de vista de quem usa — são parte daquele mod.
    // Some da lista (evita a linha duplicada tipo "DynamicMaps" + "DynamicMaps-1.1.3")
    // e a remoção do mod leva esses arquivos junto (ver uninstallMod).
    // Se o mod ligado não existir mais, o órfão VOLTA a aparecer — senão viraria
    // arquivo invisível e impossível de remover pelo app.
    const linkedTo = registryEntry?.linkedModIds ?? (registryEntry?.linkedModId ? [registryEntry.linkedModId] : []);
    if (linkedTo.length > 0 && linkedTo.some((id) => namedModIds.has(id))) continue;

    // Vínculo implícito: órfão com o mesmo nome de exibição de um mod que existe é,
    // na prática, sobra daquele mod. Cobre instalações feitas antes do vínculo
    // explícito existir — sem isso, elas ficam duplicando a linha do mod pra sempre.
    const displayName = registryEntry?.displayName;
    if (displayName && namedModIds.has(displayName)) continue;

    mods.push({
      id: manifestId,
      name: aliases[manifestId] ?? registryEntry?.displayName ?? manifestId,
      originalName: registryEntry?.displayName ?? manifestId,
      type: registryEntry?.type ?? "hybrid",
      enabled: true,
      installedManually: false,
      loadOrder: 99,
      installedAt: registryEntry?.installedAt,
      manifestOnly: true,
      linkedModName: resolveLinkedName(registryEntry?.linkedModId)
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

export async function installModFromArchive(
  clientRoot: string,
  serverRoot: string,
  archivePath: string,
  preferredDisplayName?: string,
  forgeInfo?: ForgeInstallInfo
): Promise<InstallResult> {
  const tmpExtractDir = path.join(clientRoot, ".tmp-mod-extract-" + Date.now());
  try {
    ensureDir(tmpExtractDir);
    await extractArchive(archivePath, tmpExtractDir);

    const mergeRoot = findMergeRoot(tmpExtractDir);

    if (mergeRoot) {
      return performMerge(clientRoot, serverRoot, mergeRoot, archivePath, tmpExtractDir, preferredDisplayName, forgeInfo);
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
      destBase = p(serverRoot, SERVER_MODS_DIR);
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
      destBase = p(clientRoot, CLIENT_PLUGINS_DIR);
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
    addToRegistry(clientRoot, {
      id: modId,
      displayName: modId,
      type,
      installedAt: new Date().toISOString(),
      source: "archive-install",
      forgeName: forgeInfo?.name,
      forgeAuthor: forgeInfo?.author,
      forgeVersion: forgeInfo?.version,
      forgeGuid: forgeInfo?.guid
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
 * pra dentro da instância SPT, registra cada mod encontrado individualmente, e rastreia
 * qualquer arquivo "solto" por manifesto. Compartilhada entre o fluxo normal de
 * instalação e a confirmação manual de estrutura incomum.
 *
 * Quando a instância é "dividida" (clientRoot !== serverRoot), a cópia é dividida também:
 * tudo que está dentro de "user/" vai pro serverRoot, e o resto (BepInEx/ e qualquer
 * arquivo solto na raiz do mod) vai pro clientRoot. Em instâncias normais (a grande
 * maioria) clientRoot e serverRoot são a mesma pasta, então isso não muda nada na prática.
 */
/**
 * Alguns mods empacotam a parte de servidor dentro de uma pasta-embrulho (quase sempre
 * chamada "SPT"), lado a lado com o BepInEx solto na raiz:
 *
 *   BepInEx/plugins/FooClient/     <- direto na raiz
 *   SPT/user/mods/Foo/             <- embrulhado
 *
 * Como existe "BepInEx" na raiz, findMergeRoot para ali e nunca entra no embrulho —
 * então a parte de servidor não era reconhecida (ficava sem registro, aparecendo como
 * "instalado manualmente") e, numa instalação não-dividida, ainda era copiada pro lugar
 * errado (<raiz>/SPT/user/mods em vez de <raiz>/user/mods).
 *
 * Aqui a gente achata esses embrulhos ANTES da mesclagem, movendo "user"/"BepInEx" de
 * dentro deles pra raiz da extração. Assim o resto da lógica funciona sem saber que o
 * embrulho existiu. É tudo dentro da pasta temporária, então mover é barato.
 */
function flattenWrapperDirs(mergeRoot: string): void {
  for (const entry of fs.readdirSync(mergeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const lower = entry.name.toLowerCase();
    if (lower === "user" || lower === "bepinex") continue; // já está no lugar certo

    const wrapperPath = path.join(mergeRoot, entry.name);
    const inner = fs.readdirSync(wrapperPath, { withFileTypes: true });
    const relevant = inner.filter(
      (e) => e.isDirectory() && (e.name.toLowerCase() === "user" || e.name.toLowerCase() === "bepinex")
    );
    if (relevant.length === 0) continue; // não é embrulho, é conteúdo do mod mesmo

    for (const folder of relevant) {
      const from = path.join(wrapperPath, folder.name);
      const to = path.join(mergeRoot, folder.name);
      if (fs.existsSync(to)) {
        // Já existe na raiz (ex: BepInEx nos dois lugares) — funde em vez de sobrescrever.
        copyRecursive(from, to);
        fs.rmSync(from, { recursive: true, force: true });
      } else {
        fs.renameSync(from, to);
      }
    }
    // Remove o embrulho se não sobrou nada dentro dele.
    if (fs.readdirSync(wrapperPath).length === 0) {
      fs.rmSync(wrapperPath, { recursive: true, force: true });
    }
  }
}

function performMerge(
  clientRoot: string,
  serverRoot: string,
  mergeRoot: string,
  archivePath: string,
  tmpExtractDir: string,
  preferredDisplayName?: string,
  forgeInfo?: ForgeInstallInfo
): InstallResult {
  flattenWrapperDirs(mergeRoot);
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
    (f) =>
      !attributedExactFiles.has(f) &&
      !attributedPrefixes.some((prefix) => f.startsWith(prefix)) &&
      // Nunca rastrear o core da SPT: além de não ser copiado, se entrasse no manifesto
      // remover o mod apagaria o núcleo do client.
      !isProtectedInstancePath(f)
  );

  // Cópia dividida: "user/" vai pro serverRoot, o resto (BepInEx/ e qualquer arquivo
  // solto na raiz) vai pro clientRoot. Quando as duas raízes são a mesma pasta, dá
  // exatamente no mesmo resultado de sempre.
  const userSrc = path.join(mergeRoot, "user");
  if (hasUserFolder) {
    copyRecursive(userSrc, path.join(serverRoot, "user"));
    const verification = verifyCopyRecursive(userSrc, path.join(serverRoot, "user"));
    if (!verification.ok) {
      cleanup(tmpExtractDir);
      return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
    }
  }
  const skippedCoreFiles: string[] = [];
  for (const entry of mergeEntries) {
    if (entry.name.toLowerCase() === "user") continue; // já tratado acima
    const srcPath = path.join(mergeRoot, entry.name);
    const destPath = path.join(clientRoot, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveProtected(srcPath, destPath, entry.name, skippedCoreFiles);
      const verification = verifyCopyRecursive(srcPath, destPath, skippedCoreFiles, entry.name);
      if (!verification.ok) {
        cleanup(tmpExtractDir);
        return { success: false, message: `Instalação incompleta: arquivo não confirmado no destino (${verification.missing}).` };
      }
    } else if (!isProtectedInstancePath(entry.name)) {
      ensureDir(clientRoot);
      fs.copyFileSync(srcPath, destPath);
    } else {
      skippedCoreFiles.push(entry.name);
    }
  }

  cleanup(tmpExtractDir);
  const mergedType: ModType = hasUserFolder && hasBepInExFolder ? "hybrid" : hasUserFolder ? "server" : hasBepInExFolder ? "client" : "unknown";

  // Se der pra saber com certeza que o(s) arquivo(s) solto(s) pertencem a um único mod
  // nomeado desse mesmo install (o caso comum: um .cfg avulso ao lado da pasta real do
  // plugin), a gente liga os dois — remover um remove o outro, pra nunca sobrar lixo nem
  // "quebrar" o mod por remover só a metade. Se tiver mais de um mod nomeado no mesmo
  // install, não dá pra saber a qual pertence, então não liga nenhum.
  const orphanId = orphanFiles.length > 0 ? "hybrid-manifest-" + Date.now() : undefined;
  // Os arquivos soltos pertencem ao PACOTE, não a um mod específico — um arquivo pode
  // instalar a parte de servidor e a de cliente ao mesmo tempo (ex: mpstark-dynamicmaps
  // + DynamicMaps) e o config solto é dos dois. Por isso todo mod nomeado desse mesmo
  // arquivo aponta pros arquivos soltos, e eles só somem quando o ÚLTIMO deles sai.
  const allNamedModIds = [...serverModNames, ...clientModNames];

  for (const name of serverModNames) {
    addToRegistry(clientRoot, {
      id: name,
      displayName: name,
      type: "server",
      installedAt: new Date().toISOString(),
      source: "archive-install",
      linkedModId: orphanId
    });
  }
  for (const name of clientModNames) {
    addToRegistry(clientRoot, {
      id: name,
      displayName: name,
      type: "client",
      installedAt: new Date().toISOString(),
      source: "archive-install",
      linkedModId: orphanId
    });
  }
  if (orphanId) {
    // Reinstalar o mesmo mod não pode empilhar entradas: o id do órfão é baseado em
    // timestamp, então cada instalação criava mais uma. Remove as anteriores do mesmo
    // pacote antes de registrar a nova.
    const orphanDisplayName = preferredDisplayName ?? path.parse(archivePath).name;
    for (const previous of loadRegistry(clientRoot)) {
      const isSamePackageOrphan =
        previous.id.startsWith("hybrid-manifest-") && previous.displayName === orphanDisplayName;
      if (isSamePackageOrphan) {
        removeManifestEntry(clientRoot, previous.id);
        removeFromRegistry(clientRoot, previous.id);
      }
    }

    // Registra como um mod "órfão" rastreado por manifesto — não tem pasta própria pra
    // habilitar/desabilitar, mas pelo menos aparece na lista e pode ser removido de forma limpa.
    addManifestEntry(clientRoot, orphanId, orphanFiles);
    addToRegistry(clientRoot, {
      id: orphanId,
      displayName: preferredDisplayName ?? path.parse(archivePath).name,
      type: mergedType,
      installedAt: new Date().toISOString(),
      source: "archive-install",
      linkedModIds: allNamedModIds
    });
  }
  if (skippedCoreFiles.length > 0) {
    return {
      success: true,
      message: `Mod instalado. ${skippedCoreFiles.length} arquivo(s) do núcleo do SPT vieram no pacote e foram ignorados, pra não quebrar a instalação.`
    };
  }
  return { success: true, message: "Mod instalado e verificado (estrutura completa detectada)." };
}

/**
 * Só aceita operar em pastas que o próprio Manager criou pra extração temporária desta
 * instância — nunca um caminho arbitrário vindo do processo renderer, que não é
 * totalmente confiável pra apagar ou mesclar coisas direto na instância SPT. As pastas
 * temporárias são sempre criadas dentro de clientRoot (ver installModFromArchive acima).
 */
function isOwnTempExtractDir(clientRoot: string, tmpDir: string): boolean {
  const resolved = path.resolve(tmpDir);
  const expectedParent = path.resolve(clientRoot);
  return path.dirname(resolved) === expectedParent && path.basename(resolved).startsWith(".tmp-mod-extract-");
}

// Usada quando o usuário revisa uma estrutura de arquivo incomum e escolhe "Continuar
// mesmo assim" — reaproveita a extração já feita (sem baixar/extrair de novo) e força a
// mesclagem direto na instância SPT.
export function finalizeUnrecognizedInstall(
  clientRoot: string,
  serverRoot: string,
  tmpDir: string,
  archivePath: string,
  preferredDisplayName?: string
): InstallResult {
  if (!isOwnTempExtractDir(clientRoot, tmpDir)) {
    return { success: false, message: "Caminho temporário inválido." };
  }
  if (!fs.existsSync(tmpDir)) {
    return { success: false, message: "A extração temporária não existe mais — tente instalar o arquivo de novo." };
  }
  return performMerge(clientRoot, serverRoot, tmpDir, archivePath, tmpDir, preferredDisplayName);
}

// Usada quando o usuário aborta depois de revisar uma estrutura de arquivo incomum.
export function discardPendingInstall(clientRoot: string, tmpDir: string): { success: boolean; message: string } {
  if (!isOwnTempExtractDir(clientRoot, tmpDir)) {
    return { success: false, message: "Caminho temporário inválido." };
  }
  cleanup(tmpDir);
  return { success: true, message: "Instalação cancelada." };
}

// --- Habilitar/desabilitar (move entre pasta ativa e .disabled) ---
/**
 * Move a pasta de um mod entre a pasta ativa e a .disabled. Devolve false quando não há
 * o que mover (não existe na origem, ou o destino já está ocupado).
 */
function moveModEntry(clientRoot: string, serverRoot: string, id: string, type: ModType, enable: boolean): boolean {
  const isServer = type === "server";
  const base = isServer ? serverRoot : clientRoot;
  const activeDir = p(base, isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR);
  const disabledDir = p(base, isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR);
  const from = enable ? path.join(disabledDir, id) : path.join(activeDir, id);
  const to = enable ? path.join(activeDir, id) : path.join(disabledDir, id);
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  ensureDir(enable ? activeDir : disabledDir);
  fs.renameSync(from, to);
  return true;
}

/** As outras partes do mesmo pacote (ex: a metade servidor de um mod client+server). */
function findPackageSiblings(clientRoot: string, modId: string): RegistryEntry[] {
  const registry = loadRegistry(clientRoot);
  const own = registry.find((r) => r.id === modId);
  if (!own?.packageId) return [];
  return registry.filter((r) => r.packageId === own.packageId && r.id !== modId && !r.id.startsWith("hybrid-manifest-"));
}

export function toggleMod(clientRoot: string, serverRoot: string, mod: ModInfo): { success: boolean; message: string } {
  if (mod.type === "client" && isProtectedClientEntry(mod.id)) {
    return { success: false, message: "Esse item é um arquivo do próprio SPT (não é um mod) e não pode ser alternado." };
  }

  const isServer = mod.type === "server";
  const base = isServer ? serverRoot : clientRoot;
  const activeDir = p(base, isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR);
  const disabledDir = p(base, isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR);
  ensureDir(disabledDir);
  ensureDir(activeDir);

  const from = mod.enabled ? path.join(activeDir, mod.id) : path.join(disabledDir, mod.id);
  const to = mod.enabled ? path.join(disabledDir, mod.id) : path.join(activeDir, mod.id);

  if (!fs.existsSync(from)) {
    return { success: false, message: "Arquivo/pasta do mod não encontrado: " + from };
  }
  fs.renameSync(from, to);

  // A pasta de dados que acompanha um .dll solto precisa acompanhar o habilitar/
  // desabilitar também — senão o plugin é movido e os dados dele ficam pra trás.
  if (!isServer && mod.id.toLowerCase().endsWith(".dll")) {
    const baseName = mod.id.slice(0, -4);
    const companionFrom = path.join(mod.enabled ? activeDir : disabledDir, baseName);
    const companionTo = path.join(mod.enabled ? disabledDir : activeDir, baseName);
    if (fs.existsSync(companionFrom) && fs.statSync(companionFrom).isDirectory() && !fs.existsSync(companionTo)) {
      fs.renameSync(companionFrom, companionTo);
    }
  }

  // Prepatchers do mesmo mod acompanham o habilitar/desabilitar. Sem isso, desabilitar
  // o Wedge (por exemplo) movia Wedge.Client.dll mas deixava Wedge.Prepatch.dll rodando.
  let movedPatchers = 0;
  if (!isServer) {
    const patchersActive = p(clientRoot, CLIENT_PATCHERS_DIR);
    const patchersDisabled = p(clientRoot, CLIENT_PATCHERS_DISABLED_DIR);
    const patchersFrom = mod.enabled ? patchersActive : patchersDisabled;
    const patchersTo = mod.enabled ? patchersDisabled : patchersActive;

    const registryEntry = loadRegistry(clientRoot).find((r) => r.id === mod.id);
    const manifestFiles = registryEntry?.linkedModId
      ? (loadManifest(clientRoot)[registryEntry.linkedModId] ?? [])
      : [];

    const related = findRelatedPatcherFiles(patchersFrom, mod.id, manifestFiles);
    if (related.length > 0) {
      ensureDir(patchersTo);
      for (const filePath of related) {
        const target = path.join(patchersTo, path.basename(filePath));
        if (!fs.existsSync(target)) {
          fs.renameSync(filePath, target);
          movedPatchers++;
        }
      }
    }
  }

  // As outras partes do mesmo pacote acompanham: um mod com metade servidor e metade
  // cliente meio desabilitado normalmente não funciona, e o usuário quase nunca quer isso.
  let movedSiblings = 0;
  for (const sibling of findPackageSiblings(clientRoot, mod.id)) {
    if (moveModEntry(clientRoot, serverRoot, sibling.id, sibling.type, !mod.enabled)) movedSiblings++;
  }

  if (movedSiblings > 0) {
    return {
      success: true,
      message: mod.enabled
        ? `Mod desabilitado (${movedSiblings + 1} partes do pacote).`
        : `Mod habilitado (${movedSiblings + 1} partes do pacote).`
    };
  }

  if (movedPatchers > 0) {
    return {
      success: true,
      message: mod.enabled
        ? `Mod desabilitado (e ${movedPatchers} patcher(s) junto).`
        : `Mod habilitado (e ${movedPatchers} patcher(s) junto).`
    };
  }
  return { success: true, message: mod.enabled ? "Mod desabilitado." : "Mod habilitado." };
}

// --- Desinstalar ---
export function uninstallMod(clientRoot: string, serverRoot: string, mod: ModInfo): { success: boolean; message: string } {
  if (mod.type === "client" && isProtectedClientEntry(mod.id)) {
    return { success: false, message: "Esse item é um arquivo do próprio SPT (não é um mod) e não pode ser removido pelo Manager." };
  }

  // Mods "órfãos" (manifestOnly) não têm uma pasta própria com o nome do mod —
  // são arquivos soltos rastreados individualmente no manifesto. Precisa apagar
  // cada arquivo listado, em vez de tentar achar uma pasta chamada `mod.id`.
  if (mod.manifestOnly) {
    const manifest = loadManifest(clientRoot);
    const files = manifest[mod.id];
    if (!files || files.length === 0) {
      // Registro já estava vazio/inconsistente — ainda assim limpa a entrada
      // da lista pra não deixar um fantasma que ninguém consegue remover.
      removeManifestEntry(clientRoot, mod.id);
      removeFromRegistry(clientRoot, mod.id);
      return { success: true, message: "Entrada removida da lista (nenhum arquivo rastreado)." };
    }
    let removedCount = 0;
    for (const relPath of files) {
      const target = resolveManifestFilePath(clientRoot, serverRoot, relPath);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        removedCount++;
      }
    }
    removeManifestEntry(clientRoot, mod.id);
    removeFromRegistry(clientRoot, mod.id);
    return { success: true, message: `${removedCount} arquivo(s) órfão(s) removido(s).` };
  }

  const isServer = mod.type === "server";
  const base = isServer ? serverRoot : clientRoot;
  const dir = p(base, mod.enabled ? (isServer ? SERVER_MODS_DIR : CLIENT_PLUGINS_DIR) : isServer ? SERVER_MODS_DISABLED_DIR : CLIENT_PLUGINS_DISABLED_DIR);
  const target = path.join(dir, mod.id);
  if (!fs.existsSync(target)) {
    return { success: false, message: "Mod não encontrado: " + target };
  }
  fs.rmSync(target, { recursive: true, force: true });

  // Prepatchers do mod saem junto na remoção — nas duas pastas, já que o mod pode estar
  // desabilitado no momento em que é removido.
  if (!isServer) {
    for (const patchersDir of [p(clientRoot, CLIENT_PATCHERS_DIR), p(clientRoot, CLIENT_PATCHERS_DISABLED_DIR)]) {
      for (const filePath of findRelatedPatcherFiles(patchersDir, mod.id)) {
        fs.rmSync(filePath, { force: true });
      }
    }
  }

  // Client mod solto (.dll) costuma ter uma pasta de dados de mesmo nome ao lado —
  // ela não é listada como mod (é dado dele), então precisa sair junto.
  if (!isServer && mod.id.toLowerCase().endsWith(".dll")) {
    const companion = path.join(dir, mod.id.slice(0, -4));
    if (fs.existsSync(companion) && fs.statSync(companion).isDirectory()) {
      fs.rmSync(companion, { recursive: true, force: true });
    }
  }

  // Remove também os arquivos soltos que vieram no mesmo arquivo desse mod. Eles
  // não aparecem como item separado na lista (ver scanMods), então precisam sair
  // junto — do contrário ficariam órfãos de verdade, sem dono e sem como remover.
  const registryAfter = loadRegistry(clientRoot);
  const registryEntry = registryAfter.find((r) => r.id === mod.id);
  let linkedFilesRemoved = 0;
  // Só remove os arquivos do pacote quando nenhum outro mod do mesmo arquivo continua
  // instalado — senão apagaria o config de um mod que ainda está lá.
  const orphanEntry =
    (registryEntry?.linkedModId ? registryAfter.find((r) => r.id === registryEntry.linkedModId) : undefined) ??
    // Vínculo implícito (ver scanMods): órfão com o mesmo nome de exibição desse mod.
    registryAfter.find((r) => r.id.startsWith("hybrid-manifest-") && r.displayName === mod.id);
  // Um "irmão" pode ser de outro tipo (o pacote instala server e client), e pode estar
  // habilitado ou desabilitado — por isso checamos as quatro combinações.
  const siblingsStillInstalled = (orphanEntry?.linkedModIds ?? []).some((id) => {
    if (id === mod.id) return false;
    return (["server", "client"] as const).some((type) =>
      [true, false].some((enabled) => fs.existsSync(resolveModPath(clientRoot, serverRoot, { id, type, enabled })))
    );
  });
  if (orphanEntry && !siblingsStillInstalled) {
    const manifest = loadManifest(clientRoot);
    for (const relPath of manifest[orphanEntry.id] ?? []) {
      const linkedTarget = resolveManifestFilePath(clientRoot, serverRoot, relPath);
      if (fs.existsSync(linkedTarget)) {
        fs.rmSync(linkedTarget, { force: true });
        linkedFilesRemoved++;
      }
    }
    removeManifestEntry(clientRoot, orphanEntry.id);
    removeFromRegistry(clientRoot, orphanEntry.id);
  }

  removeFromRegistry(clientRoot, mod.id);
  return {
    success: true,
    message:
      linkedFilesRemoved > 0
        ? `Mod removido (e ${linkedFilesRemoved} arquivo(s) que vieram junto).`
        : "Mod removido."
  };
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

/**
 * Como copyRecursive, mas nunca escreve por cima do núcleo do client da SPT. `relPrefix`
 * é o caminho já percorrido a partir da raiz da instância, pra decidir a proteção pelo
 * caminho completo (e não só pelo nome do arquivo). Devolve o que foi pulado, pra poder
 * avisar quem instalou.
 */
function copyRecursiveProtected(src: string, dest: string, relPrefix = "", skipped: string[] = []): string[] {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (isProtectedInstancePath(rel)) {
      skipped.push(rel);
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveProtected(srcPath, destPath, rel, skipped);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  return skipped;
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
function verifyCopyRecursive(
  src: string,
  dest: string,
  // Arquivos deliberadamente não copiados (núcleo da SPT que veio junto no pacote) —
  // sem isso a verificação acusaria "instalação incompleta" por algo que a gente
  // decidiu pular de propósito.
  intentionallySkipped: string[] = [],
  relPrefix = ""
): { ok: boolean; missing?: string } {
  const skippedSet = new Set(intentionallySkipped);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (skippedSet.has(rel) || isProtectedInstancePath(rel)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const result = verifyCopyRecursive(srcPath, destPath, intentionallySkipped, rel);
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
  guid?: string; // identificador da Forge, gravado ao atualizar pelo app
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
  skippedByBudget?: string[]; // não consultados: o orçamento de requisições acabou antes
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
/* --------------------------------------------------------------------------
 * Casamento de mod instalado -> mod da Forge.
 *
 * O nome da pasta quase nunca é igual ao nome publicado na Forge:
 *   "DrakiaXYZ-BigBrain"                -> "BigBrain"
 *   "unbreakableKeys"                   -> "Unbreakable keys"
 *   "acidphantasm-bosseshavelegamedals" -> "Bosses Have Lega Medals"
 * Por isso a busca só por nome exato (como era antes) falhava na maioria dos
 * mods, e quase tudo caía em "não encontrado".
 *
 * Agora tentamos várias estratégias, da mais confiável pra menos:
 *   1. slug exato          (derivado do nome da pasta, inclusive quebrando camelCase)
 *   2. nome exato
 *   3. slug/nome sem o prefixo de autor ("DrakiaXYZ-" etc.)
 *   4. busca full-text     (último recurso)
 *
 * As estratégias 3 e 4 podem gerar candidato genérico demais ("Amands-Graphics"
 * vira "graphics"), então elas SÓ são aceitas se passarem numa verificação de
 * plausibilidade. Casar errado é pior que não casar: além de mostrar
 * "atualização disponível" mentirosa, o restaurador de modlist usa esse mesmo
 * casamento pra baixar mod automaticamente — casar errado instalaria o mod errado.
 * ------------------------------------------------------------------------ */

function slugifyName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // camelCase -> camel-Case
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

// Reduz a uma forma comparável: só letras e números, minúsculo. Usado pra
// verificar se um resultado da Forge realmente corresponde ao que pedimos.
function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitAuthorPrefix(name: string): { author?: string; rest: string } {
  // O ponto é tão comum quanto o hífen como separador de autor: numa instalação real,
  // 16 mods não casavam só por isso (Tyfon.UIFixes, IcyClawz.ItemAttributeFix,
  // Kat.BetterAmmoLoadingList, Tosox.DynamicItemWeights, ...).
  const match = /^([A-Za-z0-9]+)[-_.](.+)$/.exec(name);
  // O resto precisa ter letra: senão "SAIN.4.4.3" viraria autor "SAIN" + nome "4.4.3",
  // e o sufixo de versão seria tratado como se fosse o nome do mod.
  if (match && match[2].length >= 3 && /[a-zA-Z]/.test(match[2])) {
    return { author: match[1], rest: match[2] };
  }
  return { rest: name };
}

/**
 * Pasta nomeada com o GUID do mod ("com.swiftxp.spt.showmethemoney"). O último segmento
 * costuma ser o nome, e o segundo, o autor — que serve de verificação.
 */
function splitGuidLikeFolder(name: string): { author?: string; rest?: string } {
  const parts = name.split(".");
  if (parts.length < 3) return {};
  if (!/^(com|org|net|me|xyz|io|dev)$/i.test(parts[0])) return {};
  return { author: parts[1], rest: parts[parts.length - 1] };
}

interface MatchCandidates {
  strictSlugs: string[]; // derivados do nome COMPLETO da pasta — alta confiança
  strictNames: string[];
  looseSlugs: string[]; // sem o prefixo de autor — precisam de verificação
  looseNames: string[];
  authorHint?: string;
}

/**
 * Tira do nome da pasta o que não faz parte do nome do mod na Forge. Padrões vistos numa
 * instalação real de 136 mods, todos falhando o casamento antes disso:
 *
 *   "WTT-PackNStrap-2.0.4"  -> "WTT-PackNStrap"    (versão anexada na pasta)
 *   "SAIN.4.4.3"            -> "SAIN"
 *   "MedicalAttention-Client" -> "MedicalAttention" (metade cliente de um pacote)
 *   "MergeConsumablesServer"  -> "MergeConsumables"
 *   "[SVM] Server Value Modifier" -> "Server Value Modifier"
 */
function stripFolderNameNoise(name: string): string[] {
  const variants = new Set<string>([name]);
  let current = name;

  // "[SVM] Nome" -> "Nome"
  const withoutTag = current.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (withoutTag && withoutTag !== current) {
    variants.add(withoutTag);
    current = withoutTag;
  }

  // sufixo de versão: "-2.0.4", ".4.4.3", "_1.2"
  const withoutVersion = current.replace(/[-._]v?\d+(\.\d+){1,3}$/i, "").trim();
  if (withoutVersion && withoutVersion !== current) {
    variants.add(withoutVersion);
    current = withoutVersion;
  }

  // sufixo de parte do pacote: "-Client", "Server", ".Net"
  const withoutPart = current.replace(/[-._]?(client|server|\.net)$/i, "").trim();
  if (withoutPart && withoutPart.length >= 3 && withoutPart !== current) {
    variants.add(withoutPart);
  }

  return [...variants].filter(Boolean);
}

function buildMatchCandidates(folderName: string): MatchCandidates {
  const { cleanName } = stripLoadOrderPrefix(folderName); // ignora "01_" de pastas legadas
  const { author, rest } = splitAuthorPrefix(cleanName);
  const spaced = (v: string) =>
    v
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase -> camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // "UIFixes" -> "UI Fixes"
      .replace(/[-_.]+/g, " ")
      .trim();

  const guidLike = splitGuidLikeFolder(cleanName);
  const cleanVariants = [...new Set([...stripFolderNameNoise(cleanName), ...(guidLike.rest ? [guidLike.rest] : [])])];
  const strictSlugs = [...new Set(cleanVariants.map(slugifyName))].filter(Boolean);
  // No máximo 2 tentativas de nome por mod: a mais limpa primeiro (mais chance de bater
  // com o nome publicado) e a crua como reserva. Mais que isso multiplica requisições
  // sem ganho proporcional, e o orçamento é curto.
  const orderedVariants = [...cleanVariants].sort((a, b) => a.length - b.length);
  const strictNames = [...new Set(orderedVariants.flatMap((v) => [v, spaced(v)]))]
    // Variante sem letra nenhuma ("4 4 3") nunca vai casar com nome de mod — só gastaria
    // uma requisição do orçamento.
    .filter((v) => v && /[a-zA-Z]/.test(v))
    .slice(0, 3);
  const looseSlugs =
    rest !== cleanName ? [...new Set([slugifyName(rest)])].filter(Boolean) : [];
  // Ordena pela forma com espaços primeiro: o nome publicado quase sempre tem espaços
  // ("UI Fixes", "Dynamic Item Weights"), não camelCase.
  // O nome sem o autor também precisa passar pela limpeza: "Tyfon.UIFixes.Server"
  // deixa "UIFixes.Server", e o que interessa é "UI Fixes".
  const looseRaw = guidLike.rest ?? (rest !== cleanName ? rest : undefined);
  const looseBase = looseRaw ? (stripFolderNameNoise(looseRaw).sort((a, b) => a.length - b.length)[0] ?? looseRaw) : undefined;
  const looseNames = looseBase
    ? [...new Set([spaced(looseBase), looseBase])].filter((v) => v && /[a-zA-Z]/.test(v))
    : [];

  // Na pasta-GUID ("com.swiftxp.spt.showmethemoney"), o split simples pegaria "com"
  // como autor — o autor de verdade é o segundo segmento.
  return { strictSlugs, strictNames, looseSlugs, looseNames, authorHint: guidLike.author ?? author };
}

/**
 * Um casamento "solto" (sem prefixo de autor, ou via busca full-text) só vale se
 * der pra confirmar de outro jeito: ou o autor na Forge bate com o prefixo que a
 * gente tirou do nome da pasta, ou o nome publicado contém o que procuramos.
 */
function isPlausibleMatch(candidate: any, searched: string, authorHint?: string): boolean {
  const rawName = String(candidate?.name ?? "");
  // O nome PUBLICADO também pode ter prefixo em colchetes ("[SAIN] Twitch Players"),
  // então a comparação precisa considerar as duas formas dos dois lados.
  const rawNameNoTag = rawName.replace(/^\[[^\]]+\]\s*/, "").trim();
  const rawSlug = String(candidate?.slug ?? "");
  const forgeName = normalizeForCompare(rawName);
  const forgeSlug = normalizeForCompare(rawSlug);
  const forgeOwner = normalizeForCompare(String(candidate?.owner?.name ?? ""));
  const target = normalizeForCompare(searched);
  if (!target) return false;

  // 1) Igualdade — o caso ideal.
  if (forgeSlug === target || forgeName === target) return true;

  // 2) Autor confere — forte o bastante mesmo com nome diferente.
  if (authorHint && forgeOwner && forgeOwner === normalizeForCompare(authorHint)) return true;

  // 3) Nome publicado começa com o que procuramos, terminando em limite de palavra.
  //    Cobre o caso MUITO comum de a Forge usar título longo enquanto a pasta usa o
  //    nome curto: "SAIN" -> "SAIN - Solarint's AI Modifications - ...".
  //    O limite de palavra evita casar "keys" com "KeysReworked": exigimos que o que
  //    vem logo depois no nome ORIGINAL não seja letra/número.
  if (normalizeForCompare(rawNameNoTag) === target) return true;
  if (target.length >= 3 && startsWithAtWordBoundary(rawName, searched)) return true;
  if (target.length >= 3 && rawNameNoTag !== rawName && startsWithAtWordBoundary(rawNameNoTag, searched)) return true;
  if (target.length >= 3 && startsWithAtWordBoundary(rawSlug, searched)) return true;

  return false;
}

/**
 * "SAIN - Solarint's..." começa com "SAIN" seguido de espaço -> true.
 * "KeysReworked" começa com "Keys" seguido de "R" (letra) -> false.
 * A comparação ignora maiúsculas e pontuação no trecho comparado, mas exige que o
 * caractere logo após o trecho seja um separador de verdade.
 */
function startsWithAtWordBoundary(fullValue: string, prefix: string): boolean {
  const normalizedPrefix = normalizeForCompare(prefix);
  if (!normalizedPrefix) return false;
  let consumed = 0;
  let matchedChars = 0;
  for (const char of fullValue) {
    const isAlphaNum = /[a-zA-Z0-9]/.test(char);
    if (isAlphaNum) {
      if (matchedChars >= normalizedPrefix.length) return false; // ainda em palavra -> não é limite
      if (char.toLowerCase() !== normalizedPrefix[matchedChars]) return false;
      matchedChars++;
    } else if (matchedChars >= normalizedPrefix.length) {
      return true; // consumiu o prefixo inteiro e chegou num separador
    }
    consumed++;
    if (matchedChars === normalizedPrefix.length && consumed === fullValue.length) return true;
  }
  return matchedChars === normalizedPrefix.length;
}

interface ForgeMatch {
  identifier: string;
  modId: number; // id numérico da Forge — sempre existe, mesmo quando guid é null
  latestVersion?: string;
  latestVersionLink?: string;
  forgeName?: string;
  confidence: "exact" | "derived";
}

function toForgeMatch(entry: any, confidence: "exact" | "derived"): ForgeMatch {
  const versions = Array.isArray(entry.versions) ? entry.versions : [];
  const latest = versions[0];
  return {
    identifier: typeof entry.guid === "string" ? entry.guid : String(entry.id),
    modId: Number(entry.id),
    latestVersion: latest?.version,
    latestVersionLink: latest?.link,
    forgeName: typeof entry.name === "string" ? entry.name : undefined,
    confidence
  };
}

/* Limites documentados da API da Forge: 40 req/10s (burst) e 200 req/60s (sustentado).
 * 40/10s = 1 requisição a cada 250ms no melhor caso; usamos 320ms de folga pra não
 * encostar no limite (era 120ms antes, que dava ~83 req/10s — o dobro do permitido, e
 * por isso a checagem entrava num ciclo de 429 -> espera -> 429 que parecia travada). */
const FORGE_MIN_REQUEST_INTERVAL_MS = 320;
let lastForgeRequestAt = 0;

async function forgeRateLimitGate(): Promise<void> {
  const since = Date.now() - lastForgeRequestAt;
  if (since < FORGE_MIN_REQUEST_INTERVAL_MS) {
    await delay(FORGE_MIN_REQUEST_INTERVAL_MS - since);
  }
  lastForgeRequestAt = Date.now();
}

// Estado por execução de checagem: teto de requisições e contagem de 429, pra garantir
// que a operação SEMPRE termina em tempo previsível em vez de ficar tentando pra sempre.
interface ForgeBudget {
  remaining: number;
  rateLimitHits: number;
  aborted: boolean;
}

function newForgeBudget(modCount: number): ForgeBudget {
  // ~4 tentativas por mod (uma por estratégia), com piso e teto. O teto antigo de 160
  // truncava em silêncio quem tem instalação grande: com 118 mods, a busca parava na
  // metade e o resto era reportado como "não encontrado" sem nunca ter sido consultado.
  // Até 5 requisições por mod (3 nomes + nome sem autor + busca textual). A folga
  // importa: com o orçamento exatamente no limite, um mod que usa todas as tentativas
  // empurra outro pra fora, e o que fica de fora aparece como "não encontrado" sem
  // nunca ter sido consultado.
  return { remaining: Math.min(Math.max(modCount * 7, 30), 1400), rateLimitHits: 0, aborted: false };
}

/**
 * Requisição à Forge respeitando rate limit, orçamento e 429 (com Retry-After).
 * Devolve null em qualquer falha — o chamador segue sem quebrar a checagem inteira.
 */
async function forgeFetchJson(url: string, budget: ForgeBudget, retriedAfter429 = false): Promise<any | null> {
  if (budget.aborted || budget.remaining <= 0) return null;
  budget.remaining--;
  await forgeRateLimitGate();
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "SPT-Mod-Manager" }
    });
    if (res.status === 429) {
      budget.rateLimitHits++;
      // Se continuar batendo no limite, desistir é melhor que insistir: a doc trata
      // burlar o limite como hostilidade, e o usuário prefere um resultado parcial
      // rápido a uma tela "Consultando..." parada por minutos.
      if (budget.rateLimitHits >= 3 || retriedAfter429) {
        budget.aborted = true;
        return null;
      }
      const retryAfter = Number(res.headers.get("retry-after") || 0);
      await delay(Math.min(Math.max(retryAfter, 1), 35) * 1000);
      return forgeFetchJson(url, budget, true);
    }
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * ATENÇÃO: na API da Forge, filter[name] e filter[slug] são filtros FUZZY de valor
 * único — não aceitam lista separada por vírgula (só filter[guid], filter[id] e
 * filter[hub_id] aceitam). Por isso aqui é uma requisição por valor, e o resultado
 * ainda passa por verificação, já que "fuzzy" pode trazer coisa parecida mas errada.
 *
 * include_legacy=true porque, por padrão, a Forge ESCONDE mods legados (sem
 * constraint de versão do SPT) — e vários mods instalados são justamente esses.
 */
async function fetchForgeByFuzzyFilter(filterKey: "slug" | "name", value: string, budget: ForgeBudget): Promise<any[]> {
  const url = new URL(`${FORGE_API_BASE}/mods`);
  url.searchParams.set(`filter[${filterKey}]`, value);
  url.searchParams.set("per_page", "10");
  url.searchParams.set("include", "versions");
  // Sem restringir "fields": a restauração de modlist precisa do LINK de download de
  // cada versão, e a resposta reduzida não garante trazer esse campo. Pedir o objeto
  // completo custa alguns KB a mais e evita "não baixa nada" silencioso.
  url.searchParams.set("filter[include_legacy]", "true");
  const json = await forgeFetchJson(url.toString(), budget);
  return Array.isArray(json?.data) ? json.data : [];
}

// GUID SIM aceita lote de verdade — é o único caminho realmente confiável e barato.
// Uma requisição resolve dezenas de mods, sem fuzzy e sem ambiguidade.
async function fetchForgeByIds(ids: string[], budget: ForgeBudget): Promise<any[]> {
  if (ids.length === 0) return [];
  const results: any[] = [];
  const CHUNK = 25;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const url = new URL(`${FORGE_API_BASE}/mods`);
    url.searchParams.set("filter[id]", ids.slice(i, i + CHUNK).join(","));
    url.searchParams.set("per_page", "50");
    url.searchParams.set("include", "versions");
    url.searchParams.set("filter[include_legacy]", "true");
    const json = await forgeFetchJson(url.toString(), budget);
    if (Array.isArray(json?.data)) results.push(...json.data);
  }
  return results;
}

async function fetchForgeByGuids(guids: string[], budget: ForgeBudget): Promise<any[]> {
  if (guids.length === 0) return [];
  const results: any[] = [];
  const CHUNK = 25;
  for (let i = 0; i < guids.length; i += CHUNK) {
    const url = new URL(`${FORGE_API_BASE}/mods`);
    url.searchParams.set("filter[guid]", guids.slice(i, i + CHUNK).join(","));
    url.searchParams.set("per_page", "50");
    url.searchParams.set("include", "versions");
    url.searchParams.set("filter[include_legacy]", "true");
    const json = await forgeFetchJson(url.toString(), budget);
    if (Array.isArray(json?.data)) results.push(...json.data);
  }
  return results;
}

/**
 * Resolve vários mods de uma vez. Retorna um mapa nome-da-pasta -> casamento.
 * Faz o grosso em poucas requisições em lote e só cai pra busca individual
 * (full-text) no que sobrar.
 */
/**
 * Cache de casamento: nome-da-pasta -> GUID resolvido na Forge.
 *
 * Achar um mod que NÃO declara GUID custa até 4 consultas (slug, nome, sem prefixo,
 * busca textual), e o ritmo é limitado pela API — ~1,2s por mod. Guardando o GUID
 * descoberto, a checagem seguinte resolve esse mod junto com os outros na consulta em
 * lote por GUID, que é uma requisição pra cada 25 mods. Na prática: a primeira checagem
 * é lenta, as próximas são quase instantâneas.
 */
const FORGE_MATCH_CACHE_FILE = ".spt-mod-manager-forge-match.json";

/**
 * IMPORTANTE: o cache guarda o ID NUMÉRICO da Forge, não o guid.
 *
 * Conferido numa resposta real da API: de 11 mods retornados numa busca, 8 tinham
 * "guid": null — só o autor que registra um GUID na plataforma tem esse campo. O id
 * numérico existe sempre. Guardar guid aqui deixava o cache inútil justamente pros mods
 * que mais precisam dele (os que não têm guid e caem nas estratégias lentas por nome).
 */
function loadForgeMatchCache(root: string): Record<string, string> {
  try {
    const file = path.join(root, FORGE_MATCH_CACHE_FILE);
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

function saveForgeMatchCache(root: string, cache: Record<string, string>): void {
  try {
    fs.writeFileSync(path.join(root, FORGE_MATCH_CACHE_FILE), JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // cache é otimização, não pode derrubar a checagem se falhar ao gravar
  }
}

export async function matchForgeMods(
  input: (string | { folderName: string; guid?: string })[],
  onProgress?: (done: number, total: number) => void,
  cacheRoot?: string
): Promise<Map<string, ForgeMatch> & { notChecked?: Set<string> }> {
  const cache = cacheRoot ? loadForgeMatchCache(cacheRoot) : {};
  const entries = input
    .map((v) => (typeof v === "string" ? { folderName: v, guid: undefined as string | undefined } : { ...v }))
    // Mod já resolvido numa checagem anterior: o cache guarda o id numérico da Forge.
    .map((e) => ({ ...e, cachedId: cache[e.folderName] }));
  const folderNames = entries.map((e) => e.folderName);
  const budget = newForgeBudget(folderNames.length);
  const matched = new Map<string, ForgeMatch>();
  // Mods que o orçamento de requisições não alcançou — diferente de "procurado e não
  // achado", e a UI precisa dizer isso com honestidade.
  const notChecked = new Set<string>();
  // O progresso conta MODS RESOLVIDOS, não tentativas. Contar tentativas dava um total
  // de "mods x 4 estratégias" (552 pra 136 mods), que na tela parecia uma quantidade
  // absurda de mods — e escondia o fato de que, com GUID, a maioria resolve de primeira,
  // numa requisição em lote só. Um mod conta como pronto quando casa, ou quando esgota
  // todas as estratégias.
  let exhausted = 0;
  const reportProgress = () =>
    onProgress?.(Math.min(matched.size + exhausted, folderNames.length), folderNames.length);
  const candidatesByName = new Map<string, MatchCandidates>();
  for (const folderName of folderNames) {
    candidatesByName.set(folderName, buildMatchCandidates(folderName));
  }

  // --- Passo 0: GUID (exato e em lote de verdade) ---
  // De longe o melhor caminho: filter[guid] aceita lista separada por vírgula e não é
  // fuzzy, então dezenas de mods se resolvem numa requisição só, sem chute por nome.
  // Só funciona pra mods que declaram GUID (SPT 4.0); o resto cai nos passos seguintes.
  // Lote por ID numérico: cobre tudo que já foi resolvido antes, inclusive mods sem guid.
  const cachedEntries = entries.filter((e) => e.cachedId);
  if (cachedEntries.length > 0) {
    const byId = new Map<string, any>();
    for (const entry of await fetchForgeByIds(cachedEntries.map((e) => e.cachedId!), budget)) {
      if (entry?.id !== undefined) byId.set(String(entry.id), entry);
    }
    for (const entry of cachedEntries) {
      const hit = byId.get(String(entry.cachedId));
      if (hit) matched.set(entry.folderName, toForgeMatch(hit, "exact"));
    }
    reportProgress();
  }

  const guidEntries = entries.filter((e) => e.guid && !matched.has(e.folderName));
  if (guidEntries.length > 0) {
    const byGuid = new Map<string, any>();
    for (const entry of await fetchForgeByGuids(guidEntries.map((e) => e.guid!), budget)) {
      if (entry?.guid) byGuid.set(String(entry.guid).toLowerCase(), entry);
    }
    for (const entry of guidEntries) {
      const hit = byGuid.get(String(entry.guid).toLowerCase());
      if (hit) matched.set(entry.folderName, toForgeMatch(hit, "exact"));
    }
    reportProgress(); // com GUID, a maioria já fica pronta aqui
  }

  // --- Busca por nome, mod a mod ---
  //
  // São no MÁXIMO 2 requisições por mod: o filtro por nome e, se falhar, a busca textual.
  //
  // A estratégia por slug foi removida: o slug da Forge é derivado do nome PUBLICADO, que
  // é justamente o que a gente não sabe. Conferido na API real — o slug do SAIN é
  // "sain-solarints-ai-modifications-full-ai-combat-system-replacement", enquanto o do
  // Wedge é só "wedge". Ou seja, o slug só acerta quando é igual ao nome, e nesse caso a
  // busca por nome já acha. Em compensação ela custava até 2 requisições por mod.
  //
  // Isso importa porque o orçamento é limitado pelo rate limit da Forge: com 6 requisições
  // por mod, uma instalação de 136 mods estourava o orçamento na metade da lista, e os
  // mods restantes eram reportados como "não encontrado" sem nunca terem sido consultados.
  for (const [folderName, cand] of candidatesByName) {
    if (matched.has(folderName)) continue; // já resolvido pelos lotes de id/guid
    if (budget.aborted) break;

    // 1) filtro por nome (fuzzy — o resultado SEMPRE passa por verificação)
    for (const name of cand.strictNames) {
      const hits = await fetchForgeByFuzzyFilter("name", name, budget);
      const exact = hits.find((entry) => normalizeForCompare(entry?.name ?? "") === normalizeForCompare(name));
      const hit = exact ?? hits.find((entry) => isPlausibleMatch(entry, name, cand.authorHint));
      if (hit) {
        matched.set(folderName, toForgeMatch(hit, exact ? "exact" : "derived"));
        break;
      }
      if (budget.aborted) break;
    }

    // 2) nome sem o prefixo do autor ("Tyfon.UIFixes" -> "UI Fixes")
    //
    // Aqui a verificação é mais rígida: sem o autor, o nome vira genérico ("Pause",
    // "Skipper") e um prefixo qualquer casaria com o mod errado. Só aceita se o nome
    // publicado for igual, ou se o autor na Forge confirmar.
    if (!matched.has(folderName) && !budget.aborted) {
      for (const name of cand.looseNames.slice(0, 1)) {
        const hits = await fetchForgeByFuzzyFilter("name", name, budget);
        const hit = hits.find((entry) => {
          const target = normalizeForCompare(name);
          const forgeName = normalizeForCompare(String(entry?.name ?? ""));
          const forgeNameNoTag = normalizeForCompare(String(entry?.name ?? "").replace(/^\[[^\]]+\]\s*/, ""));
          if (forgeName === target || forgeNameNoTag === target) return true;
          const owner = normalizeForCompare(String(entry?.owner?.name ?? ""));
          return !!cand.authorHint && !!owner && owner === normalizeForCompare(cand.authorHint);
        });
        if (hit) {
          matched.set(folderName, toForgeMatch(hit, "derived"));
          break;
        }
        if (budget.aborted) break;
      }
    }

    // 3) busca textual, último recurso
    if (!matched.has(folderName) && !budget.aborted) {
      const term = cand.looseNames[0] ?? cand.strictNames[0];
      if (term) {
        const url = new URL(`${FORGE_API_BASE}/mods`);
        url.searchParams.set("query", term);
        url.searchParams.set("per_page", "5");
        url.searchParams.set("include", "versions");
        url.searchParams.set("filter[include_legacy]", "true");
        const json = await forgeFetchJson(url.toString(), budget);
        const hit = (json?.data || []).find((entry: any) => isPlausibleMatch(entry, term, cand.authorHint));
        if (hit) matched.set(folderName, toForgeMatch(hit, "derived"));
      }
    }

    if (!matched.has(folderName)) {
      // Só conta como "procurado e não achado" se realmente deu pra procurar. Se o
      // orçamento acabou, esse mod não foi consultado — e dizer "não encontrado" nesse
      // caso é mentira.
      if (budget.aborted || budget.remaining <= 0) notChecked.add(folderName);
      else exhausted++;
    }
    reportProgress();
  }

  // Mods que sobraram sem ser consultados (orçamento acabou antes de chegar neles).
  for (const [folderName] of candidatesByName) {
    if (!matched.has(folderName) && !notChecked.has(folderName) && (budget.aborted || budget.remaining <= 0)) {
      notChecked.add(folderName);
    }
  }

  // Fecha o progresso: se o orçamento foi interrompido, sobram mods que não foram nem
  // casados nem esgotados — a operação acabou de qualquer forma.
  exhausted = folderNames.length - matched.size;
  reportProgress();

  if (cacheRoot) {
    // Guarda o identificador de quem foi resolvido pelas estratégias lentas, pra que a
    // próxima checagem já encontre esses mods na consulta em lote.
    const updated = { ...cache };
    for (const [folderName, match] of matched) {
      if (match.modId) updated[folderName] = String(match.modId);
    }
    saveForgeMatchCache(cacheRoot, updated);
  }

  (matched as Map<string, ForgeMatch> & { notChecked?: Set<string> }).notChecked = notChecked;
  return matched;
}

async function findForgeModInfo(
  name: string,
  sptVersion?: string
): Promise<{ identifier: string; latestVersion?: string; latestVersionLink?: string; forgeName?: string } | null> {
  try {
    const url = new URL(`${FORGE_API_BASE}/mods`);
    url.searchParams.set("filter[name]", name);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("include", "versions");
    url.searchParams.set("fields", "id,guid,name");
    if (sptVersion?.trim()) url.searchParams.set("filter[spt_version]", sptVersion.trim());
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json: any = await res.json();
    const match = json?.data?.[0];
    if (!match) return null;
    const identifier = typeof match.guid === "string" ? match.guid : String(match.id);
    const versions = Array.isArray(match.versions) ? match.versions : [];
    const latest = versions[0];
    return {
      identifier,
      latestVersion: latest?.version,
      latestVersionLink: latest?.link,
      forgeName: typeof match.name === "string" ? match.name : undefined
    };
  } catch {
    return null;
  }
}

// Acha, pelo nome (o mesmo casamento exato usado na checagem de atualização), o link de
// download da versão mais recente de um mod na Forge — usado pra "restaurar" uma modlist
// importada baixando automaticamente o que estiver faltando.
/**
 * Versão em LOTE da busca por link de download, usada pra restaurar uma modlist.
 *
 * Antes o restaurador chamava findForgeDownloadForName uma vez por mod. Cada chamada
 * criava um orçamento NOVO, então a proteção de "desistir depois de 3 respostas 429"
 * reiniciava a cada mod: bastava a API começar a limitar pra que cada um dos 118 mods
 * esperasse o Retry-After (até 35s) por conta própria. Compartilhando um orçamento só,
 * a operação inteira desiste junto e termina em tempo previsível.
 */
export async function findForgeDownloadsForNames(
  entries: { name: string; guid?: string }[],
  onProgress?: (done: number, total: number) => void,
  cacheRoot?: string
): Promise<Record<string, { downloadLink: string; version?: string; forgeName?: string; guid?: string }>> {
  // Quando a lista exportada traz o GUID, o casamento é exato e resolvido em lote —
  // sem adivinhação por nome. Listas antigas (sem GUID) continuam funcionando pelo nome.
  const matches = await matchForgeMods(
    entries.map((e) => ({ folderName: e.name, guid: e.guid })),
    onProgress,
    cacheRoot
  );
  const out: Record<string, { downloadLink: string; version?: string; forgeName?: string; guid?: string }> = {};
  const budget = newForgeBudget(entries.length);
  for (const { name } of entries) {
    const info = matches.get(name);
    if (!info) continue;

    if (info.latestVersionLink) {
      out[name] = {
        downloadLink: info.latestVersionLink,
        version: info.latestVersion,
        forgeName: info.forgeName,
        guid: info.identifier
      };
      continue;
    }

    // Casou com o mod na Forge, mas a resposta não trouxe o link de download. Em vez de
    // desistir em silêncio (o sintoma era "importa, mostra a diferença e não baixa
    // nada"), busca as versões desse mod diretamente pelo identificador.
    const url = new URL(`${FORGE_API_BASE}/mods`);
    url.searchParams.set("filter[guid]", info.identifier);
    url.searchParams.set("per_page", "1");
    url.searchParams.set("include", "versions");
    url.searchParams.set("filter[include_legacy]", "true");
    const json = await forgeFetchJson(url.toString(), budget);
    const versions = json?.data?.[0]?.versions;
    const latest = Array.isArray(versions) ? versions[0] : undefined;
    if (latest?.link) {
      out[name] = { downloadLink: latest.link, version: latest.version, forgeName: info.forgeName, guid: info.identifier };
    }
  }
  return out;
}

export async function findForgeDownloadForName(
  name: string,
  sptVersion?: string
): Promise<{ found: boolean; downloadLink?: string; version?: string; forgeName?: string }> {
  // Usa o mesmo matcher multi-estratégia da checagem de atualização, pra que
  // restaurar uma modlist ache tanto quanto ela acha.
  const matches = await matchForgeMods([name]);
  const info = matches.get(name);
  if (!info || !info.latestVersionLink) {
    // Fallback: casamento por nome exato com filtro de versão do SPT aplicado.
    const exact = await findForgeModInfo(name, sptVersion);
    if (!exact || !exact.latestVersionLink) return { found: false };
    return { found: true, downloadLink: exact.latestVersionLink, version: exact.latestVersion, forgeName: exact.forgeName };
  }
  return { found: true, downloadLink: info.latestVersionLink, version: info.latestVersion, forgeName: info.forgeName };
}

export async function checkForgeUpdates(
  mods: { name: string; originalName: string; version?: string; guid?: string }[],
  sptVersion: string,
  onProgress?: (done: number, total: number) => void,
  cacheRoot?: string
): Promise<ForgeUpdateCheckResult> {
  const trimmedVersion = sptVersion.trim();
  if (!trimmedVersion) {
    throw new Error("Informe a versão do SPT antes de verificar atualizações.");
  }

  const pairs: string[] = [];
  const nameByIdentifier = new Map<string, string>();
  const unmatched: string[] = [];
  const skippedByBudget: string[] = [];
  const infoOnly: ForgeUpdateItem[] = [];

  // Resolve TODOS os mods de uma vez (poucas requisições em lote), em vez de uma
  // requisição por mod com pausa entre elas — muito mais rápido e com muito mais
  // chance de achar, já que agora tenta slug/nome/derivado/full-text.
  // Busca pelo nome ORIGINAL (da pasta), não pelo apelido que o usuário deu —
  // assim renomear um mod pra exibição nunca quebra o casamento com a Forge.
  const matches = await matchForgeMods(
    mods.map((m) => ({ folderName: m.originalName, guid: m.guid })),
    onProgress,
    cacheRoot
  );

  const notChecked = (matches as Map<string, ForgeMatch> & { notChecked?: Set<string> }).notChecked;
  for (const mod of mods) {
    const info = matches.get(mod.originalName);
    if (!info) {
      // Distingue quem não foi consultado (orçamento de requisições esgotado) de quem
      // foi procurado e realmente não está na Forge com esse nome.
      if (notChecked?.has(mod.originalName)) skippedByBudget.push(mod.name);
      else unmatched.push(mod.name);
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
  }

  const empty: ForgeUpdateCheckResult = {
    sptVersionUsed: trimmedVersion,
    updates: [],
    blocked: [],
    upToDate: [],
    incompatible: [],
    infoOnly,
    unmatched,
    skippedByBudget
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
    updates: (data.updates || [])
      .map((u: any) => ({
        name: nameFor(u.current_version?.guid, u.current_version?.name),
        currentVersion: u.current_version?.version,
        recommendedVersion: u.recommended_version?.version,
        downloadLink: u.recommended_version?.link,
        // Identificador da Forge, pra que atualizar pelo app grave o mesmo GUID e as
        // próximas checagens desse mod não voltem a depender de casamento por nome.
        guid: u.current_version?.guid,
        reason: u.update_reason
      }))
      // A Forge às vezes devolve como "atualização" uma versão igual à instalada (por
      // exemplo, o mesmo número publicado para outra versão do SPT). Anunciar
      // "v1.2.6 disponível" pra quem já está na v1.2.6 é ruído: se o número é o mesmo,
      // não há o que atualizar.
      .filter((u: { currentVersion?: string; recommendedVersion?: string }) => {
        const norm = (v?: string) => (v ?? "").trim().replace(/^v/i, "");
        return !norm(u.recommendedVersion) || norm(u.recommendedVersion) !== norm(u.currentVersion);
      }),
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
    unmatched,
    skippedByBudget
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
  clientRoot: string,
  serverRoot: string,
  downloadLink: string,
  suggestedName: string,
  onProgress?: (receivedBytes: number, totalBytes: number) => void,
  forgeInfo?: ForgeInstallInfo
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
    tmpFilePath = path.join(clientRoot, `.tmp-forge-download-${Date.now()}-${safeName}${ext}`);

    // Grava em streaming DIRETO NO DISCO, pedaço a pedaço. Nunca segura o arquivo
    // inteiro na memória: mods de conteúdo passam facilmente de 1 GB, e tanto
    // juntar os pedaços no fim quanto usar arrayBuffer() precisariam do arquivo
    // todo (ou o dobro dele) na RAM — que é o que fazia mod grande falhar.
    const totalBytes = Number(res.headers.get("content-length") || 0);
    const reader = res.body?.getReader();
    if (!reader) {
      return { success: false, message: "Falha ao baixar/instalar da Forge: resposta sem conteúdo." };
    }
    const fileHandle = fs.createWriteStream(tmpFilePath);
    let receivedBytes = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        // Respeita a contrapressão do disco: se o buffer encheu, espera drenar
        // antes de pedir mais dados da rede.
        if (!fileHandle.write(Buffer.from(value))) {
          await new Promise<void>((resolve) => fileHandle.once("drain", () => resolve()));
        }
        receivedBytes += value.byteLength;
        onProgress?.(receivedBytes, totalBytes);
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        fileHandle.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    }

    return await installModFromArchive(clientRoot, serverRoot, tmpFilePath, suggestedName, forgeInfo);
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
/* ==========================================================================
 * Checagem de atualização do próprio Mod Manager (via releases do GitHub).
 *
 * Deliberadamente só NOTIFICA — nunca baixa nem instala nada sozinho. Um app
 * que se auto-atualiza é uma classe de risco bem diferente (e a comunidade do
 * SPT, com razão, desconfia de manager que mexe em coisa sozinho). Aqui a
 * gente só avisa que existe versão nova e abre a página do release no
 * navegador se a pessoa quiser.
 * ========================================================================== */

const GITHUB_RELEASES_API = "https://api.github.com/repos/Nevek20/SPT_Mod_Manager/releases/latest";

// A versão vem da API de releases do GitHub (é lá que o número é publicado), mas o
// link que a gente mostra é o da Forge — é de lá que o pessoal do SPT baixa de verdade.
const FORGE_MOD_PAGE = "https://forge.sp-tarkov.com/mod/2851/spt-mod-manager";

export interface AppUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadPageUrl?: string; // página da Forge — onde a pessoa efetivamente baixa
  releaseUrl?: string; // página do release no GitHub (changelog/código), como link secundário
  releaseName?: string;
}

// Compara duas versões semver numericamente ("0.10.0" > "0.9.0", que a comparação
// de string erraria). Ignora um "v" na frente, que é comum em tag do git.
function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkAppUpdate(currentVersion: string): Promise<AppUpdateInfo> {
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SPT-Mod-Manager" }
    });
    // Falha de rede, rate limit (a API pública do GitHub limita por IP) ou repo sem
    // release ainda: não é erro pro usuário, só não dá pra saber agora. Melhor ficar
    // quieto do que mostrar alarme falso.
    if (!res.ok) return { updateAvailable: false, currentVersion };
    const json: any = await res.json();
    const latestVersion: string | undefined = json?.tag_name;
    if (!latestVersion) return { updateAvailable: false, currentVersion };

    return {
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion: latestVersion.replace(/^v/i, ""),
      downloadPageUrl: FORGE_MOD_PAGE,
      releaseUrl: json?.html_url,
      releaseName: json?.name || undefined
    };
  } catch {
    return { updateAvailable: false, currentVersion };
  }
}