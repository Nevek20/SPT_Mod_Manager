/**
 * Processo de instalação (utilityProcess do Electron).
 *
 * Extrair e copiar um mod grande é trabalho síncrono pesado: o AdmZip lê o
 * arquivo inteiro, a cópia é arquivo por arquivo, e a verificação confere tudo
 * de novo. No processo principal isso congelava a janela até acabar. Aqui roda
 * longe dela, e o principal só espera a resposta.
 *
 * Uma mensagem por instalação: { id, op, args, sourceKey } -> { id, result } ou { id, error }.
 */

import { finalizeUnrecognizedInstall, installModFromArchive, setModSource } from "./modManager";

interface Pedido {
  id: number;
  op: "install" | "finalize";
  args: unknown[];
  /** Fonte ativa no principal: o registro grava de qual fonte veio o mod. */
  sourceKey?: string | null;
}

const porta = (process as unknown as { parentPort?: Electron.ParentPort }).parentPort;

porta?.on("message", async (evento: { data: Pedido }) => {
  const { id, op, args, sourceKey } = evento.data;
  try {
    setModSource(sourceKey ?? null);
    const result =
      op === "install"
        ? await installModFromArchive(...(args as Parameters<typeof installModFromArchive>))
        : finalizeUnrecognizedInstall(...(args as Parameters<typeof finalizeUnrecognizedInstall>));
    porta.postMessage({ id, result });
  } catch (err) {
    porta.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
