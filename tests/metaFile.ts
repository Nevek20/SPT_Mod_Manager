import * as fs from "fs";
import * as path from "path";
import { getMetaDir, type MetaFile } from "../electron/modManager";

/** Caminho de um arquivo de dados do app na instância de teste (criando a pasta). */
export function metaFile(raiz: string, nome: MetaFile): string {
  const dir = getMetaDir(raiz);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${nome}.json`);
}
