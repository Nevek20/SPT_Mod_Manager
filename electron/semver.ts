/**
 * Faixas de versão no formato do node-semver: o mesmo que o servidor do SPT 4
 * usa (biblioteca SemanticVersioning) pra conferir o SptVersion de cada mod.
 *
 * Importa acertar: no ModValidator do servidor, UM mod de servidor cuja faixa
 * não aceita a versão do SPT faz o servidor carregar NENHUM mod. A versão
 * anterior daqui olhava só o primeiro pedaço da faixa: ">=4.0.0 <4.1.0" virava
 * ">=4.0.0" e passava como compatível no 4.1.6, justo o caso que derruba tudo.
 *
 * Cobre: comparadores (<, <=, >, >=, =), ~, ^, x-ranges (4.1.x, 4.x, *),
 * versões parciais (4.1), faixas com hífen (4.0.0 - 4.1.0), E (espaço) e
 * OU (||). Sufixo de pré-lançamento é ignorado: o SPT não publica com ele.
 */

type Tripla = [number, number, number];

/** Versão concreta ("4.1.6", "v4.1.6", "4.1.6-beta"). null se não der pra ler. */
export function lerVersao(texto: string | undefined): Tripla | null {
  if (!texto) return null;
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i.exec(texto);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function comparar(a: Tripla, b: Tripla): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** Parte de uma faixa: número, ou curinga (x, X, *) ou ausente. */
interface Parcial {
  partes: (number | null)[]; // null = curinga
}

function lerParcial(texto: string): Parcial | null {
  const limpo = texto.trim().replace(/^v/i, "").replace(/[-+].*$/, "");
  if (!limpo) return null;
  const pedacos = limpo.split(".");
  if (pedacos.length > 3) return null;
  const partes: (number | null)[] = [];
  for (const p of pedacos) {
    if (p === "x" || p === "X" || p === "*") partes.push(null);
    else if (/^\d+$/.test(p)) partes.push(Number(p));
    else return null;
  }
  // Depois do primeiro curinga, todo o resto também é curinga.
  const iCuringa = partes.indexOf(null);
  if (iCuringa >= 0) for (let i = iCuringa; i < partes.length; i++) partes[i] = null;
  return { partes };
}

/** Quantas partes concretas a versão parcial tem (4.1.x -> 2). */
function concretas(p: Parcial): number {
  const i = p.partes.indexOf(null);
  return i === -1 ? p.partes.length : i;
}

function base(p: Parcial): Tripla {
  return [p.partes[0] ?? 0, p.partes[1] ?? 0, p.partes[2] ?? 0];
}

/** Menor versão que NÃO pertence mais ao prefixo concreto (4.1 -> 4.2.0). */
function proximoPrefixo(p: Parcial): Tripla | null {
  const n = concretas(p);
  if (n === 0) return null; // "*": sem teto
  const b = base(p);
  if (n === 1) return [b[0] + 1, 0, 0];
  if (n === 2) return [b[0], b[1] + 1, 0];
  return null; // versão completa: o teto é ela mesma (tratado à parte)
}

type Teste = (v: Tripla) => boolean;

function comparador(op: string, versao: string): Teste[] | null {
  const p = lerParcial(versao);
  if (!p) return null;
  const n = concretas(p);
  const b = base(p);
  const teto = proximoPrefixo(p);
  const ge: Teste = (v) => comparar(v, b) >= 0;

  switch (op) {
    case "":
    case "=":
      if (n === 0) return [() => true];
      if (n === 3) return [(v) => comparar(v, b) === 0];
      return [ge, (v) => comparar(v, teto!) < 0];
    case ">=":
      return n === 0 ? [() => true] : [ge];
    case ">":
      if (n === 0) return [() => false];
      // ">4.1" no node-semver é ">=4.2.0"
      if (n < 3) return [(v) => comparar(v, teto!) >= 0];
      return [(v) => comparar(v, b) > 0];
    case "<":
      return n === 0 ? [() => false] : [(v) => comparar(v, b) < 0];
    case "<=":
      if (n === 0) return [() => true];
      // "<=4.1" é "<4.2.0"
      if (n < 3) return [(v) => comparar(v, teto!) < 0];
      return [(v) => comparar(v, b) <= 0];
    case "~": {
      if (n === 0) return [() => true];
      // ~4.1.5 -> <4.2.0 ; ~4.1 -> <4.2.0 ; ~4 -> <5.0.0
      const lim: Tripla = n === 1 ? [b[0] + 1, 0, 0] : [b[0], b[1] + 1, 0];
      return [ge, (v) => comparar(v, lim) < 0];
    }
    case "^": {
      if (n === 0) return [() => true];
      // Trava o primeiro número diferente de zero (regra do node-semver).
      let lim: Tripla;
      if (b[0] > 0 || n === 1) lim = [b[0] + 1, 0, 0];
      else if (b[1] > 0 || n === 2) lim = [0, b[1] + 1, 0];
      else lim = [0, 0, b[2] + 1];
      return [ge, (v) => comparar(v, lim) < 0];
    }
    default:
      return null;
  }
}

/** Um conjunto "E" (separado por espaço). null se algo não puder ser lido. */
function conjunto(texto: string): Teste[] | null {
  let t = texto.trim();
  if (!t) return [() => true];
  // Faixa com hífen: "4.0.0 - 4.1.0" -> ">=4.0.0 <=4.1.0"
  const hifen = /^(\S+)\s+-\s+(\S+)$/.exec(t);
  if (hifen) t = `>=${hifen[1]} <=${hifen[2]}`;
  // Junta operador solto do número (">= 4.0.0" -> ">=4.0.0").
  t = t.replace(/(<=|>=|<|>|=|~>?|\^)\s+/g, "$1");
  const testes: Teste[] = [];
  for (const token of t.split(/\s+/)) {
    const m = /^(<=|>=|<|>|=|~>?|\^)?(.*)$/.exec(token);
    if (!m) return null;
    const op = m[1] === "~>" ? "~" : m[1] ?? "";
    const c = comparador(op, m[2]);
    if (!c) return null;
    testes.push(...c);
  }
  return testes;
}

/**
 * A versão satisfaz a faixa? null quando a faixa ou a versão não dá pra ler:
 * melhor "não sei" do que afirmar compatibilidade (ou a falta dela) no chute.
 */
export function satisfaz(faixa: string | undefined, versao: string | undefined): boolean | null {
  const v = lerVersao(versao);
  if (!v || faixa === undefined || !faixa.trim()) return null;
  let algumLegivel = false;
  for (const alternativa of faixa.split("||")) {
    const testes = conjunto(alternativa);
    if (!testes) continue;
    algumLegivel = true;
    if (testes.every((teste) => teste(v))) return true;
  }
  return algumLegivel ? false : null;
}

/**
 * A faixa não aceita esta versão, mas aceita outra do MESMO major.minor
 * (ex.: o mod declara "4.1.5" e a instância é 4.1.6). Pra mod de CLIENT isso
 * costuma funcionar; pra mod de servidor não importa: o servidor recusa.
 */
export function quaseSatisfaz(faixa: string | undefined, versao: string | undefined): boolean {
  const v = lerVersao(versao);
  if (!v || satisfaz(faixa, versao) !== false) return false;
  for (let patch = 0; patch <= Math.max(v[2] + 20, 50); patch++) {
    if (patch === v[2]) continue;
    if (satisfaz(faixa, `${v[0]}.${v[1]}.${patch}`) === true) return true;
  }
  return false;
}
