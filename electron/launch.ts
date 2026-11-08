/**
 * Iniciar o servidor e o launcher do SPT.
 *
 * A 1ª versão usava spawn(exe, { detached: true }). No Windows o libuv traduz
 * "detached" em DETACHED_PROCESS, que cria o processo SEM console nenhum. O
 * launcher é um app de janela e não liga pra isso, mas o SPT.Server.exe é de
 * console: sem console ele fecha na hora ou fica rodando invisível, sem log.
 * Era exatamente o relato: o launcher abria e o servidor não.
 *
 * Agora vai pelo "start" do cmd, que é o que o Explorer faz no clique duplo:
 * console próprio, pasta de trabalho certa e processo independente do app.
 */
import path from "path";
import { execFile, spawn } from "child_process";

export interface ComandoIniciar {
  file: string;
  args: string[];
  verbatim: boolean;
}

/** Monta o comando. Separado pra dar pra testar sem Windows. */
export function comandoIniciar(exe: string, plataforma: NodeJS.Platform = process.platform, comspec = process.env.ComSpec): ComandoIniciar {
  if (plataforma !== "win32") return { file: exe, args: [], verbatim: false };
  // Aspas não existem em nome de arquivo no Windows; se aparecerem, é
  // tentativa de injetar comando, e não segue.
  if (exe.includes('"')) throw new Error("Invalid executable path.");
  const pasta = path.win32.dirname(exe);
  // /s faz o cmd tirar só as aspas de fora e manter o resto como está. O
  // primeiro "" é o título da janela (o start trata o 1º argumento entre
  // aspas como título). /D define a pasta de trabalho: o servidor procura
  // SPT_Data e user/ relativos a ela.
  return {
    file: comspec || "cmd.exe",
    args: ["/d", "/s", "/c", `"start "" /D "${pasta}" "${exe}""`],
    verbatim: true
  };
}

export function iniciarExecutavel(exe: string): Promise<void> {
  const cmd = comandoIniciar(exe);
  return new Promise((resolve, reject) => {
    const filho = spawn(cmd.file, cmd.args, {
      cwd: path.dirname(exe),
      // Fora do Windows (desenvolvimento) o executável é chamado direto.
      detached: process.platform !== "win32",
      stdio: "ignore",
      windowsHide: true, // esconde só o cmd intermediário, não a janela do servidor
      windowsVerbatimArguments: cmd.verbatim
    });
    filho.once("error", reject);
    // O cmd termina logo depois de disparar o start: o spawn deu certo.
    filho.once("spawn", () => {
      filho.unref();
      resolve();
    });
  });
}

/**
 * O executável já está rodando? Pergunta ao Windows pelo nome do processo,
 * porque o app não acompanha mais o processo que iniciou (quem fica vivo é o
 * filho do start). Isso também pega o servidor aberto por fora do app, que
 * brigaria pela mesma porta.
 *
 * Na dúvida (tasklist indisponível), responde false: bloquear o botão por
 * falha da consulta seria pior que deixar abrir.
 */
export function estaRodando(exe: string): Promise<boolean> {
  if (process.platform !== "win32") return Promise.resolve(false);
  const nome = path.win32.basename(exe);
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", `IMAGENAME eq ${nome}`, "/NH", "/FO", "CSV"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.toLowerCase().includes(`"${nome.toLowerCase()}"`));
    });
  });
}
