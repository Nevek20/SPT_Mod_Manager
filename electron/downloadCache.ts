/**
 * Cache dos arquivos baixados da fonte (issue #5, samlitowitz).
 *
 * Mod grande baixado de novo sem ter mudado de versão é banda e tempo jogados
 * fora: reinstalar, importar lista em outra instância, voltar uma remoção. Aqui
 * o arquivo fica guardado na pasta de dados do app (não na do SPT: vale pra
 * todas as instâncias e apagar o SPT não leva o cache junto).
 *
 * Regras:
 * - A chave é o link MAIS a versão. Só o link não basta: tem autor que usa link
 *   de "última versão" (releases/latest/download/...), que serve arquivos
 *   diferentes com o mesmo endereço. Sem versão conhecida, não entra no cache.
 * - Cada arquivo mora numa subpasta com o nome da chave, e o arquivo em si tem o
 *   nome do mod: a instalação usa o nome do arquivo como nome de pasta em alguns
 *   casos (DLL solta no zip), e um hash ali viraria a pasta do mod.
 * - Passou do limite, saem os usados há mais tempo. Arquivo em uso (baixando ou
 *   instalando) nunca sai.
 * - Tudo aqui é auxílio: qualquer erro de cache cai pro download normal, nunca
 *   impede uma instalação.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface CacheEntry {
  /** Caminho relativo à pasta do cache: <chave>/<arquivo>. */
  file: string;
  size: number;
  link: string;
  version: string;
  name: string;
  addedAt: number;
  lastUsed: number;
}

export interface CacheInfo {
  enabled: boolean;
  limitBytes: number;
  usedBytes: number;
  count: number;
}

interface IndiceArquivo {
  version: 1;
  entries: Record<string, CacheEntry>;
}

const INDICE = "index.json";
const CHAVE_RE = /^[0-9a-f]{32}$/;

export const GB = 1024 * 1024 * 1024;
/** Opções que a interface oferece (0 = desligado). Fora disto, o main recusa. */
export const CACHE_LIMIT_OPTIONS_GB = [0, 2, 5, 10, 20] as const;
export const CACHE_DEFAULT_GB = 5;

/** "<chave>/<arquivo>", sem subir de pasta nem descer mais um nível. */
function arquivoDaChave(chave: string, file: string): boolean {
  const m = /^([0-9a-f]{32})\/([^/\\]+)$/.exec(file);
  return !!m && m[1] === chave && m[2] !== "." && m[2] !== "..";
}

export function chaveDoCache(link: string, version: string): string {
  return crypto.createHash("sha256").update(`${link}\n${version}`).digest("hex").slice(0, 32);
}

export class DownloadCache {
  private entries: Record<string, CacheEntry> = {};
  private emUso = new Map<string, number>();
  /** Relógio próprio que nunca anda pra trás, pra dois usos no mesmo milissegundo terem ordem. */
  private ultimoTick = 0;

  constructor(readonly dir: string, private limitBytes: number) {
    try {
      this.carregar();
    } catch {
      this.entries = {};
    }
  }

  get enabled(): boolean {
    return this.limitBytes > 0;
  }

  get limit(): number {
    return this.limitBytes;
  }

  private agora(): number {
    this.ultimoTick = Math.max(Date.now(), this.ultimoTick + 1);
    return this.ultimoTick;
  }

  private carregar() {
    if (!fs.existsSync(this.dir)) return;
    const caminho = path.join(this.dir, INDICE);
    let bruto: unknown = null;
    try {
      bruto = JSON.parse(fs.readFileSync(caminho, "utf-8"));
    } catch {
      bruto = null;
    }
    const lidas = (bruto as IndiceArquivo | null)?.entries;
    if (lidas && typeof lidas === "object") {
      for (const [chave, e] of Object.entries(lidas)) {
        if (!CHAVE_RE.test(chave) || !e || typeof e !== "object") continue;
        if (typeof e.file !== "string" || typeof e.size !== "number" || typeof e.link !== "string") continue;
        // O índice é nosso, mas mora em disco: um caminho que saia da subpasta da
        // própria chave é ignorado em vez de seguido.
        if (!arquivoDaChave(chave, e.file)) continue;
        const abs = path.join(this.dir, e.file);
        try {
          if (fs.statSync(abs).size !== e.size) continue;
        } catch {
          continue;
        }
        this.entries[chave] = {
          file: e.file,
          size: e.size,
          link: e.link,
          version: typeof e.version === "string" ? e.version : "",
          name: typeof e.name === "string" ? e.name : "",
          addedAt: typeof e.addedAt === "number" ? e.addedAt : 0,
          lastUsed: typeof e.lastUsed === "number" ? e.lastUsed : 0
        };
        this.ultimoTick = Math.max(this.ultimoTick, this.entries[chave].lastUsed);
      }
    }
    // Sobra de download interrompido (app fechado no meio) ou de entrada que o
    // índice perdeu: só pastas com cara de chave, nada mais é apagado.
    for (const nome of fs.readdirSync(this.dir)) {
      if (CHAVE_RE.test(nome) && !this.entries[nome]) this.apagaPasta(nome);
    }
    this.gravar();
  }

  private gravar() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = path.join(this.dir, `${INDICE}.tmp`);
      const dados: IndiceArquivo = { version: 1, entries: this.entries };
      fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
      fs.renameSync(tmp, path.join(this.dir, INDICE));
    } catch {
      // Sem índice gravado o cache só fica mais frio na próxima abertura.
    }
  }

  private apagaPasta(chave: string): boolean {
    if (!CHAVE_RE.test(chave)) return false;
    try {
      fs.rmSync(path.join(this.dir, chave), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Caminho do arquivo guardado pra este link e versão, ou undefined. Marca como usado. */
  lookup(link: string, version: string | undefined): string | undefined {
    if (!this.enabled || !version) return undefined;
    const chave = chaveDoCache(link, version);
    const e = this.entries[chave];
    if (!e) return undefined;
    const abs = path.join(this.dir, e.file);
    try {
      if (fs.statSync(abs).size !== e.size) throw new Error("size");
    } catch {
      // Sumiu ou mudou por fora: esquece e baixa de novo.
      delete this.entries[chave];
      this.apagaPasta(chave);
      this.gravar();
      return undefined;
    }
    e.lastUsed = this.agora();
    this.gravar();
    return abs;
  }

  /**
   * Pasta onde baixar este arquivo, ou undefined se ele não deve entrar no cache
   * (desligado, sem versão, ou maior que o limite inteiro).
   */
  slotFor(link: string, version: string | undefined, tamanhoEsperado: number): string | undefined {
    if (!this.enabled || !version) return undefined;
    if (tamanhoEsperado > this.limitBytes) return undefined;
    const chave = chaveDoCache(link, version);
    const pasta = path.join(this.dir, chave);
    try {
      // Pasta velha da mesma chave (entrada perdida): começa limpo.
      if (!this.entries[chave]) fs.rmSync(pasta, { recursive: true, force: true });
      fs.mkdirSync(pasta, { recursive: true });
      return pasta;
    } catch {
      return undefined;
    }
  }

  /** Marca a chave como em uso: não sai por limite nem por "Limpar cache". */
  acquire(link: string, version: string) {
    const chave = chaveDoCache(link, version);
    this.emUso.set(chave, (this.emUso.get(chave) ?? 0) + 1);
  }

  release(link: string, version: string) {
    const chave = chaveDoCache(link, version);
    const n = (this.emUso.get(chave) ?? 0) - 1;
    if (n > 0) this.emUso.set(chave, n);
    else this.emUso.delete(chave);
  }

  /** Registra um arquivo que acabou de ser baixado e instalado com sucesso. */
  commit(link: string, version: string, arquivo: string, name: string) {
    const chave = chaveDoCache(link, version);
    const relativo = path.relative(this.dir, arquivo);
    if (path.dirname(relativo) !== chave) return;
    let size: number;
    try {
      size = fs.statSync(arquivo).size;
    } catch {
      return;
    }
    if (size > this.limitBytes) {
      this.discard(link, version);
      return;
    }
    const t = this.agora();
    // O índice guarda sempre "/", também no Windows.
    this.entries[chave] = { file: `${chave}/${path.basename(arquivo)}`, size, link, version, name, addedAt: t, lastUsed: t };
    this.evict();
    this.gravar();
  }

  /** Tira do cache (download que falhou ou arquivo que não instalou). */
  discard(link: string, version: string) {
    const chave = chaveDoCache(link, version);
    delete this.entries[chave];
    this.apagaPasta(chave);
    this.gravar();
  }

  private usado(): number {
    return Object.values(this.entries).reduce((s, e) => s + e.size, 0);
  }

  private evict() {
    let usado = this.usado();
    if (usado <= this.limitBytes) return;
    const ordem = Object.entries(this.entries).sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
    for (const [chave, e] of ordem) {
      if (usado <= this.limitBytes) break;
      if (this.emUso.has(chave)) continue;
      if (this.apagaPasta(chave)) {
        delete this.entries[chave];
        usado -= e.size;
      }
    }
  }

  /** Muda o limite. Desligar (0) apaga tudo: cache desligado não deve ocupar disco. */
  setLimit(bytes: number) {
    this.limitBytes = Math.max(0, bytes);
    if (this.limitBytes === 0) this.clear();
    else {
      this.evict();
      this.gravar();
    }
  }

  /** Apaga tudo que não estiver em uso. Devolve quantos ficaram por estarem em uso. */
  clear(): { removed: number; kept: number } {
    let removed = 0;
    let kept = 0;
    for (const chave of Object.keys(this.entries)) {
      if (this.emUso.has(chave)) {
        kept++;
        continue;
      }
      if (this.apagaPasta(chave)) {
        delete this.entries[chave];
        removed++;
      } else {
        kept++;
      }
    }
    this.gravar();
    return { removed, kept };
  }

  info(): CacheInfo {
    return {
      enabled: this.enabled,
      limitBytes: this.limitBytes,
      usedBytes: this.usado(),
      count: Object.keys(this.entries).length
    };
  }
}
