import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { readExeProductVersion } from "./electron/peVersion";

let ok = 0;
let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         esperado ${JSON.stringify(want)}\n         obtido   ${JSON.stringify(got)}`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pever-"));

/** Monta um par chave/valor como o VS_VERSIONINFO grava: UTF-16LE, valor alinhado. */
function entry(key: string, value: string): Buffer {
  const k = Buffer.from(key + "\0", "utf16le");
  const padding = Buffer.alloc((4 - (k.length % 4)) % 4); // alinhamento de 4 bytes
  const v = Buffer.from(value + "\0", "utf16le");
  return Buffer.concat([k, padding, v]);
}

function fakeExe(name: string, ...blocks: Buffer[]): string {
  const file = path.join(dir, name);
  // Lixo binário antes e depois, como num PE de verdade.
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(2048, 0x4d), ...blocks, Buffer.alloc(512, 0x90)]));
  return file;
}

console.log("\nleitura da versao do executavel");

check(
  "SPT.Server.exe 4.1.2 real: ProductVersion com sufixo vira semver limpo",
  readExeProductVersion(
    fakeExe(
      "server412.exe",
      entry("FileDescription", "SPT.Server"),
      entry("FileVersion", "4.1.2.0"),
      entry("ProductName", "SPT.Server"),
      entry("ProductVersion", "4.1.2-RELEASE+cf04a11.2026")
    )
  ),
  "4.1.2"
);

check(
  "sem ProductVersion, cai no FileVersion e descarta o quarto campo",
  readExeProductVersion(fakeExe("so-file.exe", entry("FileVersion", "4.0.13.0"))),
  "4.0.13"
);

check(
  "ProductVersion sem numero nenhum é ignorado, segue pro FileVersion",
  readExeProductVersion(
    fakeExe("sem-numero.exe", entry("ProductVersion", "RELEASE"), entry("FileVersion", "3.11.5.0"))
  ),
  "3.11.5"
);

check(
  "executavel sem bloco de versao devolve undefined",
  readExeProductVersion(fakeExe("nada.exe")),
  undefined
);

check("arquivo inexistente devolve undefined", readExeProductVersion(path.join(dir, "fantasma.exe")), undefined);

check(
  "versao de duas partes nao vira semver quebrado",
  readExeProductVersion(fakeExe("curta.exe", entry("ProductVersion", "4.1"))),
  undefined
);

// Um arquivo grande com o bloco depois do limite de leitura não deve travar nem
// devolver lixo — só não achar.
{
  const file = path.join(dir, "gigante.exe");
  fs.writeFileSync(file, Buffer.concat([Buffer.alloc(5 * 1024 * 1024, 0x00), entry("ProductVersion", "9.9.9")]));
  check("bloco alem do limite de leitura: nao acha, mas nao quebra", readExeProductVersion(file), undefined);
}

console.log(`\n${ok} ok, ${fail} falhas\n`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
