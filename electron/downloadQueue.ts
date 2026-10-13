/**
 * Fila de downloads (0.7.0).
 *
 * Antes cada clique em "Instalar" ia direto pro backend: três cliques eram três
 * downloads E três instalações ao mesmo tempo, gravando o mesmo registro do app
 * (uma gravação podia apagar a outra). Aqui:
 *
 * - Download: até N ao mesmo tempo (1 por padrão, 2 ou 3 nas configurações).
 * - Instalação: SEMPRE uma de cada vez, inclusive as de arquivo local, que
 *   passam pelo mesmo cadeado (exclusive).
 * - Pausar libera a vaga pro próximo; continuar volta pra posição e espera a vez.
 * - Cancelar funciona em tudo, menos durante a instalação: parar no meio deixaria
 *   um mod pela metade no disco.
 *
 * Genérico (não sabe o que é um mod) pra ser testado com tarefas de mentira.
 */

export type QueueJobState = "queued" | "downloading" | "paused" | "waiting" | "installing";

export interface QueueJobSnapshot {
  id: string;
  name: string;
  state: QueueJobState;
  received: number;
  total: number;
  /** Bytes por segundo, média recente (não a média desde o começo). */
  speed: number;
  fromCache: boolean;
  /** O servidor não aceitou continuar de onde parou e o download recomeçou. */
  restarted: boolean;
}

/** O que a tarefa devolve chega inteiro em quem chamou enqueue (campos extras incluídos). */
export interface QueueResult {
  success: boolean;
  message: string;
  cancelled?: boolean;
  needsConfirmation?: boolean;
}

export interface QueueTask {
  /**
   * Baixa (ou continua baixando). Pode ser chamada de novo depois de uma pausa.
   * Tem que parar quando o signal abortar, rejeitando.
   */
  download(signal: AbortSignal, onProgress: (received: number, total: number) => void): Promise<void>;
  install(): Promise<QueueResult>;
  /** Limpa o que foi baixado. Chamada quando o job é cancelado ou falha. */
  discard(): void;
  readonly fromCache?: boolean;
  readonly restarted?: boolean;
}

interface Job {
  id: string;
  name: string;
  task: QueueTask;
  state: QueueJobState | "finished";
  received: number;
  total: number;
  speed: number;
  ultimaAmostra?: { t: number; bytes: number };
  controller?: AbortController;
  motivoAbort?: "pause" | "cancel";
  /** Jobs que precisam terminar antes deste INSTALAR (dependências, ordem do lote). */
  depois: string[];
  resolve: (r: QueueResult) => void;
}

/** Erro cuja mensagem já é a final pra pessoa (sem o prefixo genérico de falha). */
export class QueueError extends Error {}

export const MAX_DOWNLOADS_OPTIONS = [1, 2, 3] as const;
export const CANCELLED_MESSAGE = "Cancelled.";

export class DownloadQueue {
  private jobs: Job[] = [];
  /** Fim de cada job ativo, pra quem instala "depois" dele esperar. */
  private fins = new Map<string, Promise<QueueResult>>();
  private cadeado: Promise<unknown> = Promise.resolve();
  private aviso: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private maxDownloads = 1,
    private onChange: (snapshot: QueueJobSnapshot[]) => void = () => {},
    private agora: () => number = () => Date.now()
  ) {}

  /**
   * Roda `fn` sozinho: nenhuma outra instalação (da fila ou de arquivo local)
   * acontece ao mesmo tempo. Ordem de chegada.
   */
  exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const vez = this.cadeado.then(() => fn());
    // O próximo espera este terminar, dando certo ou não.
    this.cadeado = vez.catch(() => undefined);
    return vez;
  }

  /**
   * `depois`: ids que precisam terminar (dando certo, falhando ou cancelados)
   * antes deste instalar. O download não espera: só a instalação. É o que deixa
   * o mod principal entrar na fila junto com as dependências e ainda assim
   * instalar por último, mesmo com 2 ou 3 downloads ao mesmo tempo.
   */
  enqueue(id: string, name: string, task: QueueTask, depois: string[] = []): Promise<QueueResult> {
    if (this.jobs.some((j) => j.id === id)) {
      return Promise.resolve({ success: false, message: "This download is already in the queue." });
    }
    const fim = new Promise<QueueResult>((resolve) => {
      this.jobs.push({ id, name, task, state: "queued", received: 0, total: 0, speed: 0, depois, resolve });
    });
    this.fins.set(id, fim);
    this.avisar();
    this.bombear();
    return fim;
  }

  snapshot(): QueueJobSnapshot[] {
    return this.jobs
      .filter((j) => j.state !== "finished")
      .map((j) => ({
        id: j.id,
        name: j.name,
        state: j.state as QueueJobState,
        received: j.received,
        total: j.total,
        speed: j.state === "downloading" ? j.speed : 0,
        fromCache: !!j.task.fromCache,
        restarted: !!j.task.restarted
      }));
  }

  setMaxDownloads(n: number) {
    this.maxDownloads = Math.max(1, Math.floor(n));
    this.bombear();
  }

  pause(id: string): boolean {
    const job = this.achar(id);
    if (!job || job.state !== "downloading" || !job.controller) return false;
    job.motivoAbort = "pause";
    job.controller.abort();
    return true;
  }

  resume(id: string): boolean {
    const job = this.achar(id);
    if (!job || job.state !== "paused") return false;
    job.state = "queued";
    this.avisar();
    this.bombear();
    return true;
  }

  cancel(id: string): boolean {
    const job = this.achar(id);
    if (!job) return false;
    switch (job.state) {
      case "installing":
      case "finished":
        return false;
      case "downloading":
        job.motivoAbort = "cancel";
        job.controller?.abort();
        return true;
      default:
        // queued, paused ou waiting (baixado, esperando a vez de instalar).
        this.terminar(job, { success: false, cancelled: true, message: CANCELLED_MESSAGE });
        return true;
    }
  }

  /** Cancela tudo que está esperando (na fila ou pausado). O que está baixando ou instalando continua. */
  cancelWaiting(): number {
    const esperando = this.jobs.filter((j) => j.state === "queued" || j.state === "paused");
    for (const j of esperando) this.cancel(j.id);
    return esperando.length;
  }

  /**
   * App fechando: para tudo e apaga o que foi baixado pela metade, na hora.
   * A instalação em andamento não é interrompida (o processo só sai depois).
   */
  shutdown() {
    for (const job of [...this.jobs]) {
      if (job.state === "installing" || job.state === "finished") continue;
      job.motivoAbort = "cancel";
      job.controller?.abort();
      try {
        job.task.discard();
      } catch {
        // best-effort
      }
    }
  }

  /** Troca de lugar com o vizinho que também está esperando. */
  move(id: string, delta: -1 | 1): boolean {
    const movivel = (j: Job) => j.state === "queued" || j.state === "paused";
    const i = this.jobs.findIndex((j) => j.id === id);
    if (i < 0 || !movivel(this.jobs[i])) return false;
    for (let k = i + delta; k >= 0 && k < this.jobs.length; k += delta) {
      if (movivel(this.jobs[k])) {
        [this.jobs[i], this.jobs[k]] = [this.jobs[k], this.jobs[i]];
        this.avisar();
        return true;
      }
    }
    return false;
  }

  private achar(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id && j.state !== "finished");
  }

  private bombear() {
    let baixando = this.jobs.filter((j) => j.state === "downloading").length;
    for (const job of this.jobs) {
      if (baixando >= this.maxDownloads) break;
      if (job.state !== "queued") continue;
      baixando++;
      void this.rodar(job);
    }
  }

  private async rodar(job: Job) {
    job.state = "downloading";
    job.motivoAbort = undefined;
    job.controller = new AbortController();
    job.ultimaAmostra = undefined;
    job.speed = 0;
    this.avisar();

    try {
      await job.task.download(job.controller.signal, (received, total) => {
        this.amostrar(job, received);
        job.received = received;
        job.total = total;
        this.avisarDepois();
      });
    } catch (err) {
      job.controller = undefined;
      if (job.motivoAbort === "pause") {
        job.state = "paused";
        job.speed = 0;
        this.avisar();
        this.bombear();
        return;
      }
      if (job.motivoAbort === "cancel") {
        this.terminar(job, { success: false, cancelled: true, message: CANCELLED_MESSAGE });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.terminar(job, {
        success: false,
        message: err instanceof QueueError ? msg : `Failed to download/install from Forge: ${msg}`
      });
      return;
    }
    job.controller = undefined;

    // Terminou de baixar no instante em que a pessoa clicou: vale o clique.
    if (job.motivoAbort === "cancel") {
      this.terminar(job, { success: false, cancelled: true, message: CANCELLED_MESSAGE });
      return;
    }
    if (job.motivoAbort === "pause") job.motivoAbort = undefined;

    job.state = "waiting";
    job.speed = 0;
    this.avisar();
    this.bombear(); // a vaga de download já está livre

    // Espera quem tem que instalar antes. Job que já terminou não está mais em
    // `fins`, então não segura nada.
    const antes = job.depois.map((id) => this.fins.get(id)).filter((p): p is Promise<QueueResult> => !!p);
    if (antes.length > 0) await Promise.all(antes);
    if (job.state !== "waiting") return; // cancelado enquanto esperava

    const resultado = await this.exclusive(async (): Promise<QueueResult | null> => {
      if (job.state !== "waiting") return null; // cancelado enquanto esperava a vez
      job.state = "installing";
      this.avisar();
      try {
        return await job.task.install();
      } catch (err) {
        return { success: false, message: `Failed to download/install from Forge: ${err instanceof Error ? err.message : String(err)}` };
      }
    });
    if (resultado) this.terminar(job, resultado);
  }

  private amostrar(job: Job, received: number) {
    const t = this.agora();
    const a = job.ultimaAmostra;
    if (!a) {
      job.ultimaAmostra = { t, bytes: received };
      return;
    }
    const dt = t - a.t;
    if (dt < 250) return;
    const inst = ((received - a.bytes) / dt) * 1000;
    // Média móvel: reage a mudança de velocidade sem pular a cada pedaço.
    job.speed = job.speed > 0 ? job.speed * 0.6 + inst * 0.4 : inst;
    job.ultimaAmostra = { t, bytes: received };
  }

  private terminar(job: Job, resultado: QueueResult) {
    if (job.state === "finished") return;
    const falhou = !resultado.success && !resultado.needsConfirmation;
    job.state = "finished";
    if (falhou) {
      try {
        job.task.discard();
      } catch {
        // limpeza é best-effort
      }
    }
    this.jobs = this.jobs.filter((j) => j !== job);
    this.fins.delete(job.id);
    this.avisar();
    job.resolve(resultado);
    this.bombear();
  }

  private avisar() {
    if (this.aviso) {
      clearTimeout(this.aviso);
      this.aviso = null;
    }
    this.onChange(this.snapshot());
  }

  /** Progresso chega a cada pedaço do download: manda no máximo ~7 por segundo. */
  private avisarDepois() {
    if (this.aviso) return;
    this.aviso = setTimeout(() => {
      this.aviso = null;
      this.onChange(this.snapshot());
    }, 150);
  }
}
