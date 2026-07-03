declare module "node-7z" {
  import { EventEmitter } from "events";

  interface SevenOptions {
    $bin?: string;
    [key: string]: unknown;
  }

  interface SevenStream extends EventEmitter {
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }

  const Seven: {
    extractFull(archivePath: string, destDir: string, options?: SevenOptions): SevenStream;
    extract(archivePath: string, destDir: string, options?: SevenOptions): SevenStream;
    list(archivePath: string, options?: SevenOptions): SevenStream;
    add(archivePath: string, source: string | string[], options?: SevenOptions): SevenStream;
  };

  export default Seven;
}
