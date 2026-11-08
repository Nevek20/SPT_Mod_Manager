/**
 * Toda requisição de rede do app passa por aqui.
 *
 * Até a 0.7.0 o app usava o fetch do Node (undici). Ele NÃO usa o proxy do
 * sistema, nem o PAC de VPN/"acelerador", nem os certificados que o Windows
 * confia — e em algumas redes isso basta pra tudo falhar com um "fetch failed"
 * seco, enquanto o navegador da mesma máquina baixa o mesmo arquivo do mesmo
 * site normalmente. Foi o relato do elizark: download manual pelo site
 * funcionava, pelo app não, em nenhuma das duas fontes.
 *
 * O processo principal do Electron registra aqui o net.fetch, que é a pilha de
 * rede do Chromium: a mesma do navegador, com proxy do sistema e tudo. Fora do
 * Electron (testes, processo de instalação) fica o fetch do Node. Se a pilha do
 * Chromium falhar por rede, tenta uma vez pelo Node antes de desistir: são
 * caminhos diferentes até o servidor, e um pode passar onde o outro não passa.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const nodeFetch: FetchLike = (url, init) => fetch(url, init);

let principal: FetchLike = nodeFetch;
let temAlternativa = false;

/** Chamado pelo main.ts com o net.fetch do Electron. */
export function setHttpFetch(fn: FetchLike) {
  principal = fn;
  temAlternativa = fn !== nodeFetch;
}

function ehAbort(err: unknown, init?: RequestInit): boolean {
  if (init?.signal?.aborted) return true;
  const nome = (err as { name?: string } | null)?.name;
  return nome === "AbortError" || nome === "TimeoutError";
}

/**
 * Transforma o "fetch failed" genérico em algo que dá pra diagnosticar: o host
 * e o código de erro de verdade (ENOTFOUND, ECONNRESET, ERR_CONNECTION_RESET,
 * certificado...). O undici esconde isso em err.cause.
 */
export function describeNetworkError(err: unknown, url: string): string {
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    // fica a URL inteira
  }
  const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string } } | null;
  const base = e?.message || String(err);
  const causa = e?.cause?.code || e?.code || e?.cause?.message;
  return causa && !base.includes(causa) ? `${base} (${causa}, ${host})` : `${base} (${host})`;
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await principal(url, init);
  } catch (err) {
    if (ehAbort(err, init)) throw err;
    if (temAlternativa) {
      try {
        return await nodeFetch(url, init);
      } catch (err2) {
        if (ehAbort(err2, init)) throw err2;
      }
    }
    throw new NetworkError(describeNetworkError(err, url));
  }
}
