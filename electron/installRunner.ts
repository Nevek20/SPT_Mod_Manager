/**
 * Lado do processo principal do instalador separado (ver installWorker.ts).
 *
 * Um processo só, criado na primeira instalação e reaproveitado. Se ele cair no
 * meio (falta de memória num mod gigante, por exemplo), a instalação em curso
 * vira erro com mensagem clara e o próximo pedido sobe um processo novo.
 * Se nem der pra criar o processo, instala no principal como antes: travar a
 * janela é ruim, não instalar é pior.
 */

import path from "path";
import { utilityProcess, type UtilityProcess } from "electron";
import { finalizeUnrecognizedInstall, installModFromArchive, getModSource, type InstallResult } from "./modManager";

type Op = "install" | "finalize";

let processo: UtilityProcess | null = null;
let proximoId = 1;
/** O processo já respondeu alguma vez? Se cair antes disso, ele não sobe nesta máquina. */
let jaRespondeu = false;
/** Desistiu do processo separado (não sobe aqui): instala no principal, como antes. */
let semProcesso = false;
const pendentes = new Map<
  number,
  { op: Op; args: unknown[]; resolve: (r: InstallResult) => void; reject: (e: Error) => void }
>();

function noPrincipal(op: Op, args: unknown[]): Promise<InstallResult> {
  return op === "install"
    ? installModFromArchive(...(args as Parameters<typeof installModFromArchive>))
    : Promise.resolve(finalizeUnrecognizedInstall(...(args as Parameters<typeof finalizeUnrecognizedInstall>)));
}

function garantirProcesso(): UtilityProcess | null {
  if (semProcesso) return null;
  if (processo) return processo;
  try {
    const p = utilityProcess.fork(path.join(__dirname, "installWorker.js"), [], {
      serviceName: "SPT Mod Manager installer"
    });
    p.on("message", (msg: { id: number; result?: InstallResult; error?: string }) => {
      const pendente = pendentes.get(msg.id);
      if (!pendente) return;
      jaRespondeu = true;
      pendentes.delete(msg.id);
      if (msg.error !== undefined) pendente.reject(new Error(msg.error));
      else pendente.resolve(msg.result as InstallResult);
    });
    p.on("exit", (codigo) => {
      if (processo === p) processo = null;
      // Caiu sem nunca ter respondido: o processo não consegue nem carregar
      // nesta máquina. Instala no principal o que estava esperando, e daqui pra
      // frente também. Melhor janela travada que instalação que nunca acontece.
      if (!jaRespondeu) {
        semProcesso = true;
        for (const [id, pendente] of pendentes) {
          pendentes.delete(id);
          noPrincipal(pendente.op, pendente.args).then(pendente.resolve, pendente.reject);
        }
        return;
      }
      // Caiu no meio de uma instalação (falta de memória, por exemplo): essa vira erro.
      for (const [id, pendente] of pendentes) {
        pendentes.delete(id);
        pendente.reject(new Error(`the installer process stopped unexpectedly (code ${codigo})`));
      }
    });
    processo = p;
    return p;
  } catch {
    return null;
  }
}

function rodar(op: Op, args: unknown[]): Promise<InstallResult> {
  const p = garantirProcesso();
  // Plano B: no principal mesmo.
  if (!p) return noPrincipal(op, args);
  const id = proximoId++;
  return new Promise<InstallResult>((resolve, reject) => {
    pendentes.set(id, { op, args, resolve, reject });
    p.postMessage({ id, op, args, sourceKey: getModSource().key });
  }).catch((err: Error) => ({ success: false, message: `Installation failed: ${err.message}` }));
}

export function instalarSeparado(...args: Parameters<typeof installModFromArchive>): Promise<InstallResult> {
  return rodar("install", args);
}

export function finalizarSeparado(...args: Parameters<typeof finalizeUnrecognizedInstall>): Promise<InstallResult> {
  return rodar("finalize", args);
}

/** Alguma instalação ainda rodando no processo separado? */
export function instalandoAgora(): boolean {
  return pendentes.size > 0;
}

/** Resolve quando não houver mais instalação rodando (pra fechar o app sem deixar mod pela metade). */
export async function esperarInstalacoes(): Promise<void> {
  while (pendentes.size > 0) await new Promise((r) => setTimeout(r, 200));
}
