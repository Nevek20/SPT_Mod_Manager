import fs from "fs";

/**
 * Lê ProductVersion / FileVersion do bloco VS_VERSIONINFO de um executável Windows.
 *
 * Por que isso existe: a partir do SPT 4.0 o core.json parou de guardar a versão do
 * SPT — só sobrou a versão do Tarkov compatível, que é outra informação. O
 * SPT.Server.exe, porém, carrega a versão de verdade no metadata do PE:
 *
 *   Versão do arquivo   4.1.2.0
 *   Versão do produto   4.1.2-RELEASE+cf04a11.2026...
 *
 * ProductVersion vem primeiro porque preserva o semver inteiro; FileVersion perde o
 * sufixo (vira 4.1.2.0), mas serve de plano B.
 *
 * A leitura é do ARQUIVO, sem executar nada. Em vez de percorrer a estrutura do PE
 * (cabeçalho, seção .rsrc, árvore de recursos), procura direto a chave em UTF-16LE
 * e lê o valor seguinte. É mais tosco, mas não depende de biblioteca nativa, não
 * quebra se o layout do PE mudar, e o pior caso é não achar nada — nunca um valor
 * errado, porque o resultado ainda é validado como versão antes de ser aceito.
 */

/** Só lê o começo do arquivo: o bloco de versão fica bem antes disso. */
const MAX_BYTES = 4 * 1024 * 1024;

function readHead(filePath: string): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, MAX_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* fechar não é crítico aqui */
      }
    }
  }
}

/**
 * Lê uma string UTF-16LE a partir de `start`, parando no terminador (00 00) em
 * limite par. Volta undefined se passar do fim do buffer sem terminar — buffer
 * truncado não deve virar string pela metade.
 */
function readUtf16(buffer: Buffer, start: number, maxChars = 128): string | undefined {
  const chars: number[] = [];
  for (let i = start; i + 1 < buffer.length && chars.length < maxChars; i += 2) {
    const code = buffer.readUInt16LE(i);
    if (code === 0) return Buffer.from(new Uint16Array(chars).buffer).toString("utf16le");
    chars.push(code);
  }
  return undefined;
}

function findValueAfterKey(buffer: Buffer, key: string): string | undefined {
  const needle = Buffer.from(key + "\0", "utf16le");
  let from = 0;

  // Pode haver mais de um bloco de idioma (StringFileInfo por language/codepage).
  // Aceita a primeira ocorrência que produza uma versão plausível, em vez de
  // travar na primeira ocorrência qualquer.
  for (;;) {
    const at = buffer.indexOf(needle, from);
    if (at === -1) return undefined;

    let cursor = at + needle.length;
    // Padding: a estrutura alinha o valor em 4 bytes, então sobram zeros entre a
    // chave e o valor. Pula os zeros até o primeiro caractere de verdade.
    while (cursor + 1 < buffer.length && buffer.readUInt16LE(cursor) === 0) cursor += 2;

    const value = readUtf16(buffer, cursor);
    if (value && /\d/.test(value)) return value.trim();

    from = at + 2;
  }
}

/**
 * Normaliza pra semver que a API entende: "4.1.2-RELEASE+cf04a11.2026" vira
 * "4.1.2", e "4.1.2.0" (FileVersion, que tem quatro campos) também.
 */
function toSemver(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

export function readExeProductVersion(exePath: string): string | undefined {
  if (!fs.existsSync(exePath)) return undefined;
  const buffer = readHead(exePath);
  if (!buffer) return undefined;

  return (
    toSemver(findValueAfterKey(buffer, "ProductVersion")) ??
    toSemver(findValueAfterKey(buffer, "FileVersion"))
  );
}
