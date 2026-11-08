/**
 * Perfis de mods (0.8.0).
 *
 * Um perfil é o conjunto de mods de uma "montagem" (quais fazem parte, quais
 * ficam ativos, com versão e id do catálogo) mais o que a pessoa configurou no
 * app pra ela: nomes de exibição, categorias próprias e vínculos manuais com a
 * página do mod. "Perfil de mods" e não só "perfil" porque, no SPT, perfil é o
 * save do jogador (user/profiles).
 *
 * O PERFIL ATIVO É O ESTADO ATUAL. Não existe "salvar perfil": o que está no
 * disco e nos arquivos do app é o perfil ativo, e a foto dele é tirada na hora
 * de trocar pra outro ou de exportar. Por isso ele se atualiza sozinho, como no
 * MO2, sem gancho em cada ação (ativar, renomear, categorizar...).
 *
 * Trocar pro perfil B: mod que não está em B é DESATIVADO (nunca removido), e o
 * que está em B fica no estado gravado. Mod de B que não existe no disco volta
 * como "faltando", e a interface oferece baixar do catálogo.
 *
 * O arquivo de export é a modlist antiga com mais campos: mods[].name continua
 * sendo o nome original da pasta, então a 0.7 ainda lê um perfil exportado pela
 * 0.8 (como lista), e a 0.8 lê as listas antigas (como perfil).
 */
import fs from "fs";
import {
  scanMods,
  toggleMod,
  loadAliases,
  saveAliases,
  loadCustomCategories,
  saveCustomCategories,
  validaCustom,
  loadForgeMatchCache,
  saveForgeMatchCache,
  getMetaDir,
  gravarJsonAtomico,
  getModSource,
  idValeNaFonteAtiva,
  type CategoriasCustom
} from "./modManager";
import path from "path";
import type { ModInfo, ModType } from "./types";

export const PROFILE_FORMAT = "spt-mod-manager-profile";
export const PROFILE_FORMAT_VERSION = 2;

export interface ProfileMod {
  /** Nome da pasta/arquivo no disco (o id do ModInfo). Ausente em lista antiga. */
  id?: string;
  /** Nome original (pasta sem prefixo, dll sem extensão). É o "name" da lista antiga. */
  name: string;
  type: ModType;
  enabled: boolean;
  version?: string;
  author?: string;
  guid?: string;
  /** Id no catálogo e de qual fonte ele é (ids não valem entre fontes quaisquer). */
  forgeId?: number;
  forgeSourceKey?: string;
  forgeName?: string;
}

export interface ProfileLink {
  ids: Record<string, string>;
  version?: string;
}

export interface ModProfile {
  id: string;
  name: string;
  updatedAt: string;
  mods: ProfileMod[];
  aliases: Record<string, string>;
  categories: CategoriasCustom;
  /** Vínculos manuais com a página do catálogo, por nome original da pasta. */
  links: Record<string, ProfileLink>;
}

interface ProfilesFile {
  active: string;
  profiles: ModProfile[];
}

export interface ProfileSummary {
  id: string;
  name: string;
  updatedAt: string;
  modCount: number;
  enabledCount: number;
}

const DEFAULT_ID = "default";
const DEFAULT_NAME = "Default";
const MAX_NOME = 60;

function arquivoPerfis(root: string): string {
  return path.join(getMetaDir(root), "profiles.json");
}

function nomeLimpo(nome: unknown): string {
  return typeof nome === "string" ? nome.trim().replace(/\s+/g, " ").slice(0, MAX_NOME) : "";
}

function novoId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Não deixa dois perfis com o mesmo nome: "Fika" vira "Fika (2)". */
function nomeUnico(nome: string, existentes: ModProfile[], ignorarId?: string): string {
  const usados = new Set(existentes.filter((p) => p.id !== ignorarId).map((p) => p.name.toLowerCase()));
  if (!usados.has(nome.toLowerCase())) return nome;
  for (let i = 2; ; i++) {
    const candidato = `${nome} (${i})`;
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
}

// ---------- validação (o arquivo pode ter sido editado, ou vir de outra pessoa) ----------

const TIPOS: ModType[] = ["server", "client", "hybrid", "unknown"];

function texto(v: unknown, max = 200): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}

export function validaProfileMod(bruto: unknown): ProfileMod | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const name = texto(b.name, 260);
  if (!name) return null;
  const type = TIPOS.includes(b.type as ModType) ? (b.type as ModType) : "unknown";
  const forgeId = typeof b.forgeId === "number" && Number.isInteger(b.forgeId) && b.forgeId > 0 ? b.forgeId : undefined;
  const id = texto(b.id, 260);
  return {
    // Nome de pasta com barra seria caminho: vira lixo, não vira id.
    id: id && !/[\\/]/.test(id) && id !== "." && id !== ".." ? id : undefined,
    name,
    type,
    // Lista antiga sem "enabled": quem está na lista estava instalado, então ativo.
    enabled: b.enabled !== false,
    version: texto(b.version, 64),
    author: texto(b.author, 120),
    guid: texto(b.guid, 200),
    forgeId,
    forgeSourceKey: forgeId ? texto(b.forgeSourceKey, 40) : undefined,
    forgeName: texto(b.forgeName, 200)
  };
}

function validaAliases(bruto: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!bruto || typeof bruto !== "object") return out;
  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    const alias = texto(v, 200);
    if (alias && k.length <= 260) out[k] = alias;
  }
  return out;
}

function validaLinks(bruto: unknown): Record<string, ProfileLink> {
  const out: Record<string, ProfileLink> = {};
  if (!bruto || typeof bruto !== "object") return out;
  for (const [pasta, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!v || typeof v !== "object" || pasta.length > 260) continue;
    const ids: Record<string, string> = {};
    for (const [fonte, id] of Object.entries(((v as Record<string, unknown>).ids ?? {}) as Record<string, unknown>)) {
      if (typeof id === "string" && /^\d+$/.test(id)) ids[fonte] = id;
    }
    if (Object.keys(ids).length === 0) continue;
    const version = texto((v as Record<string, unknown>).version, 64);
    out[pasta] = version ? { ids, version } : { ids };
  }
  return out;
}

function validaPerfil(bruto: unknown): ModProfile | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const id = texto(b.id, 40);
  const name = nomeLimpo(b.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    updatedAt: texto(b.updatedAt, 40) ?? new Date(0).toISOString(),
    mods: Array.isArray(b.mods) ? b.mods.map(validaProfileMod).filter((m): m is ProfileMod => m !== null) : [],
    aliases: validaAliases(b.aliases),
    categories: validaCustom(b.categories),
    links: validaLinks(b.links)
  };
}

// ---------- foto do estado atual ----------

function modDoScan(m: ModInfo): ProfileMod {
  const fonte = getModSource().key;
  return {
    id: m.id,
    name: m.originalName,
    type: m.type,
    enabled: m.enabled,
    version: m.version,
    author: m.author,
    guid: m.guid,
    forgeId: m.forgeModId,
    forgeSourceKey: m.forgeModId ? fonte : undefined,
    forgeName: m.forgeName
  };
}

/** O estado atual da instância, como perfil. */
export function snapshotProfile(clientRoot: string, serverRoot: string, base: { id: string; name: string }): ModProfile {
  const links: Record<string, ProfileLink> = {};
  for (const [pasta, entrada] of Object.entries(loadForgeMatchCache(clientRoot))) {
    const fontes = Object.keys(entrada.manual ?? {});
    if (fontes.length === 0) continue;
    const ids: Record<string, string> = {};
    for (const f of fontes) if (entrada.ids[f]) ids[f] = entrada.ids[f];
    if (Object.keys(ids).length === 0) continue;
    links[pasta] = entrada.version ? { ids, version: entrada.version } : { ids };
  }
  return {
    id: base.id,
    name: base.name,
    updatedAt: new Date().toISOString(),
    mods: scanMods(clientRoot, serverRoot).map(modDoScan),
    aliases: loadAliases(clientRoot),
    categories: loadCustomCategories(clientRoot),
    links
  };
}

// ---------- arquivo de perfis ----------

function lerArquivo(clientRoot: string, serverRoot: string): ProfilesFile {
  const file = arquivoPerfis(clientRoot);
  try {
    if (fs.existsSync(file)) {
      const bruto = JSON.parse(fs.readFileSync(file, "utf-8"));
      const profiles: ModProfile[] = [];
      for (const p of Array.isArray(bruto?.profiles) ? bruto.profiles : []) {
        const v = validaPerfil(p);
        if (v && !profiles.some((x) => x.id === v.id)) profiles.push(v);
      }
      if (profiles.length > 0) {
        const active = profiles.some((p) => p.id === bruto.active) ? bruto.active : profiles[0].id;
        return { active, profiles };
      }
    }
  } catch {
    // arquivo corrompido: recomeça com o estado atual como único perfil
  }
  // Primeira vez (ou arquivo perdido): o estado atual vira o perfil "Default".
  // Nada no disco muda; é só dar nome ao que já existe.
  return { active: DEFAULT_ID, profiles: [snapshotProfile(clientRoot, serverRoot, { id: DEFAULT_ID, name: DEFAULT_NAME })] };
}

function gravarArquivo(clientRoot: string, dados: ProfilesFile) {
  const file = arquivoPerfis(clientRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  gravarJsonAtomico(file, dados);
}

/** Atualiza a foto do perfil ativo com o estado atual. */
function fotografarAtivo(clientRoot: string, serverRoot: string, dados: ProfilesFile) {
  const i = dados.profiles.findIndex((p) => p.id === dados.active);
  if (i < 0) return;
  const atual = dados.profiles[i];
  dados.profiles[i] = snapshotProfile(clientRoot, serverRoot, { id: atual.id, name: atual.name });
}

function resumo(p: ModProfile): ProfileSummary {
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    modCount: p.mods.length,
    enabledCount: p.mods.filter((m) => m.enabled).length
  };
}

export function listProfiles(clientRoot: string, serverRoot: string): { active: string; profiles: ProfileSummary[] } {
  const dados = lerArquivo(clientRoot, serverRoot);
  // O ativo é mostrado com o estado de agora, não com a última foto.
  fotografarAtivo(clientRoot, serverRoot, dados);
  return { active: dados.active, profiles: dados.profiles.map(resumo) };
}

/**
 * Perfil novo a partir do estado atual, e ele passa a ser o ativo. Como é cópia
 * do que já está aplicado, nada no disco muda: a pessoa cria e segue mexendo.
 */
export function createProfile(clientRoot: string, serverRoot: string, nome: string): { success: boolean; message: string; id?: string } {
  const limpo = nomeLimpo(nome);
  if (!limpo) return { success: false, message: "Enter a name for the profile." };
  const dados = lerArquivo(clientRoot, serverRoot);
  fotografarAtivo(clientRoot, serverRoot, dados);
  const id = novoId();
  const final = nomeUnico(limpo, dados.profiles);
  dados.profiles.push(snapshotProfile(clientRoot, serverRoot, { id, name: final }));
  dados.active = id;
  gravarArquivo(clientRoot, dados);
  return { success: true, message: `Mod profile "${final}" created.`, id };
}

export function renameProfile(clientRoot: string, serverRoot: string, id: string, nome: string): { success: boolean; message: string } {
  const limpo = nomeLimpo(nome);
  if (!limpo) return { success: false, message: "Enter a name for the profile." };
  const dados = lerArquivo(clientRoot, serverRoot);
  const perfil = dados.profiles.find((p) => p.id === id);
  if (!perfil) return { success: false, message: "Mod profile not found." };
  perfil.name = nomeUnico(limpo, dados.profiles, id);
  gravarArquivo(clientRoot, dados);
  return { success: true, message: `Mod profile renamed to "${perfil.name}".` };
}

export function deleteProfile(clientRoot: string, serverRoot: string, id: string): { success: boolean; message: string } {
  const dados = lerArquivo(clientRoot, serverRoot);
  // O ativo é o estado atual: apagar ele não teria o que "desaplicar".
  if (id === dados.active) return { success: false, message: "Switch to another mod profile before deleting this one." };
  const perfil = dados.profiles.find((p) => p.id === id);
  if (!perfil) return { success: false, message: "Mod profile not found." };
  dados.profiles = dados.profiles.filter((p) => p.id !== id);
  gravarArquivo(clientRoot, dados);
  return { success: true, message: `Mod profile "${perfil.name}" deleted.` };
}

// ---------- aplicar ----------

/** O membro do perfil que corresponde a este mod do disco: pasta exata, ou nome original (lista antiga). */
function membroDe(perfil: ModProfile, mod: ModInfo): ProfileMod | undefined {
  return (
    perfil.mods.find((m) => m.id !== undefined && m.id === mod.id && m.type === mod.type) ??
    perfil.mods.find((m) => m.id === undefined && m.name === mod.originalName && (m.type === mod.type || m.type === "unknown"))
  );
}

export interface SwitchResult {
  success: boolean;
  message: string;
  /** Mods do perfil que não estão no disco, prontos pra procurar no catálogo. */
  missing: { name: string; guid?: string; version?: string; id?: number }[];
  /** Mods desativados por não fazerem parte do perfil. */
  disabled: string[];
  failed: string[];
}

function aplicarVinculos(clientRoot: string, links: Record<string, ProfileLink>) {
  const cache = loadForgeMatchCache(clientRoot);
  // Tira os vínculos manuais do perfil anterior...
  for (const entrada of Object.values(cache)) {
    for (const fonte of Object.keys(entrada.manual ?? {})) delete entrada.ids[fonte];
    delete entrada.manual;
    delete entrada.version;
  }
  // ...e põe os deste.
  for (const [pasta, link] of Object.entries(links)) {
    const entrada = cache[pasta] ?? { ids: {} };
    const manual: Record<string, true> = { ...(entrada.manual ?? {}) };
    for (const [fonte, id] of Object.entries(link.ids)) {
      entrada.ids[fonte] = id;
      manual[fonte] = true;
      if (entrada.misses) delete entrada.misses[fonte];
    }
    entrada.manual = manual;
    if (link.version) entrada.version = link.version;
    cache[pasta] = entrada;
  }
  saveForgeMatchCache(clientRoot, cache);
}

/** Aplica um perfil ao disco e aos arquivos do app. Não mexe no arquivo de perfis. */
export function applyProfile(clientRoot: string, serverRoot: string, perfil: ModProfile): Omit<SwitchResult, "success" | "message"> {
  const disabled: string[] = [];
  const failed: string[] = [];
  const presentes = new Set<ProfileMod>();

  for (const mod of scanMods(clientRoot, serverRoot)) {
    const membro = membroDe(perfil, mod);
    if (membro) presentes.add(membro);
    // Arquivos soltos rastreados por manifesto não têm pasta pra mover.
    if (mod.manifestOnly) continue;
    const desejado = membro ? membro.enabled : false;
    if (mod.enabled === desejado) continue;
    try {
      const r = toggleMod(clientRoot, serverRoot, mod, false);
      if (!r.success) failed.push(mod.name);
      else if (!membro) disabled.push(mod.name);
    } catch {
      failed.push(mod.name);
    }
  }

  saveAliases(clientRoot, perfil.aliases);
  saveCustomCategories(clientRoot, perfil.categories);
  aplicarVinculos(clientRoot, perfil.links);

  // O mesmo mod pode aparecer duas vezes (metade servidor e metade cliente com o
  // mesmo nome): pra baixar, basta uma.
  const vistos = new Set<string>();
  const missing: SwitchResult["missing"] = [];
  for (const m of perfil.mods) {
    if (presentes.has(m) || vistos.has(m.name)) continue;
    vistos.add(m.name);
    missing.push({
      name: m.name,
      guid: m.guid,
      version: m.version,
      id: m.forgeId && idValeNaFonteAtiva(m.forgeSourceKey) ? m.forgeId : undefined
    });
  }
  return { missing, disabled, failed };
}

export function switchProfile(clientRoot: string, serverRoot: string, id: string): SwitchResult {
  const dados = lerArquivo(clientRoot, serverRoot);
  const alvo = dados.profiles.find((p) => p.id === id);
  if (!alvo) return { success: false, message: "Mod profile not found.", missing: [], disabled: [], failed: [] };
  // Guarda como o perfil atual está ANTES de aplicar o outro: é o "salvar sozinho".
  fotografarAtivo(clientRoot, serverRoot, dados);
  if (id !== dados.active) {
    dados.active = id;
    // Grava a troca antes de mexer no disco: se algo falhar no meio, ao menos o
    // perfil de antes já está guardado.
    gravarArquivo(clientRoot, dados);
  }
  const r = applyProfile(clientRoot, serverRoot, alvo);
  // A foto do novo ativo continua sendo a gravada até a próxima troca ou
  // export: aí vira o estado real (e mod que a pessoa preferiu não baixar
  // sai do perfil, como sai um mod removido).
  return { success: r.failed.length === 0, message: `Switched to mod profile "${alvo.name}".`, ...r };
}

// ---------- exportar / importar ----------

export interface ProfileExport {
  format: typeof PROFILE_FORMAT;
  formatVersion: number;
  exportedAt: string;
  profileName: string;
  /** Fonte ativa no export: os forgeId de cada mod também dizem a fonte deles. */
  source: string;
  mods: ProfileMod[];
  aliases: Record<string, string>;
  categories: CategoriasCustom;
  links: Record<string, ProfileLink>;
}

export function exportProfile(clientRoot: string, serverRoot: string, id?: string): ProfileExport | null {
  const dados = lerArquivo(clientRoot, serverRoot);
  fotografarAtivo(clientRoot, serverRoot, dados);
  const perfil = dados.profiles.find((p) => p.id === (id ?? dados.active));
  if (!perfil) return null;
  return {
    format: PROFILE_FORMAT,
    formatVersion: PROFILE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    profileName: perfil.name,
    source: getModSource().key,
    mods: perfil.mods,
    aliases: perfil.aliases,
    categories: perfil.categories,
    links: perfil.links
  };
}

/**
 * Lê um perfil exportado (0.8) ou uma modlist antiga (0.7 e antes) e cria um
 * perfil novo com ele. Não aplica: quem decide trocar é a pessoa.
 */
export function importProfile(
  clientRoot: string,
  serverRoot: string,
  bruto: unknown,
  nomeArquivo: string
): { success: boolean; message: string; id?: string; name?: string; modCount?: number; missingCount?: number } {
  if (!bruto || typeof bruto !== "object" || !Array.isArray((bruto as { mods?: unknown }).mods)) {
    return { success: false, message: "This file doesn't look like a mod list exported by this app." };
  }
  const b = bruto as Record<string, unknown>;
  const mods = (b.mods as unknown[]).map(validaProfileMod).filter((m): m is ProfileMod => m !== null);
  if (mods.length === 0) return { success: false, message: "This file doesn't look like a mod list exported by this app." };

  const dados = lerArquivo(clientRoot, serverRoot);
  fotografarAtivo(clientRoot, serverRoot, dados);
  const nomeBase = nomeLimpo(b.profileName) || nomeLimpo(path.basename(nomeArquivo).replace(/\.json$/i, "")) || "Imported";
  const nome = nomeUnico(nomeBase, dados.profiles);
  const perfil: ModProfile = {
    id: novoId(),
    name: nome,
    updatedAt: new Date().toISOString(),
    mods,
    aliases: validaAliases(b.aliases),
    categories: validaCustom(b.categories),
    links: validaLinks(b.links)
  };
  dados.profiles.push(perfil);
  gravarArquivo(clientRoot, dados);

  const noDisco = scanMods(clientRoot, serverRoot);
  const presentes = new Set(noDisco.map((m) => membroDe(perfil, m)).filter((m): m is ProfileMod => !!m));
  const missingCount = new Set(mods.filter((m) => !presentes.has(m)).map((m) => m.name)).size;
  return {
    success: true,
    message: `Mod profile "${nome}" imported with ${mods.length} mod(s).`,
    id: perfil.id,
    name: nome,
    modCount: mods.length,
    missingCount
  };
}
