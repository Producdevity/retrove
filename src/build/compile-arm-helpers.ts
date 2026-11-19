import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const ROOTS = [
  "src/runtime/ios/libc/guest-libc",
  "src/runtime/ios/threads/guest-mutex",
  "src/runtime/ios/compiler-rt/vfp",
  "src/runtime/graphics/guest-bindings",
  "src/runtime/ios/profiles/bioshock/guest-hooks",
];
const HEX_RADIX = 16;
const JSON_INDENT = 2;
const directory = mkdtempSync(join(tmpdir(), "retrove-libc-"));
const llvm = process.env.RETROVE_LLVM_BIN ?? "";
function run(tool: string, args: string[]): string {
  return execFileSync(join(llvm, tool), args, { encoding: "utf8" });
}
try {
  for (const root of ROOTS) {
    const object = join(directory, "guest.o");
    const binary = join(directory, "guest.bin");
    run("clang", ["--target=armv7-none-eabi", "-c", `${root}.S`, "-o", object]);
    const relocations = run("llvm-objdump", ["-r", object]);
    if (/R_ARM_/.test(relocations)) throw new Error("ARM library contains unresolved relocations.");
    run("llvm-objcopy", ["--only-section=.text", "-O", "binary", object, binary]);
    const symbols: Record<string, number> = {};
    for (const line of run("llvm-nm", ["-n", object]).split("\n")) {
      const match = /^(?<address>[0-9a-f]+) T (?<name>retrove_\w+)$/.exec(line);
      const address = match?.groups?.address;
      const name = match?.groups?.name;
      if (address && name) symbols[name] = Number.parseInt(address, HEX_RADIX);
    }
    const artifact = { code: readFileSync(binary).toString("base64"), symbols };
    writeFileSync(`${root}.json`, JSON.stringify(artifact, null, JSON_INDENT) + "\n");
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
