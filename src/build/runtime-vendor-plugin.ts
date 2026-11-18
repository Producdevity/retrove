import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Plugin } from "vite-plus";
const VENDOR_ROOT = "web/vendor/";
const FILES = [
  "unicorn-arm.mjs",
  "texture2ddecoder.mjs",
  "texture2ddecoder.wasm",
  "sqlite3.mjs",
  "sqlite3.wasm",
] as const;
const HASH_LENGTH = 16;
export function runtimeVendors(): Plugin {
  const sources = Promise.all(
    FILES.map(async (name) => ({ name, source: await readFile(VENDOR_ROOT + name) })),
  );
  const directory = sources.then((files) => {
    const digest = createHash("sha256");
    for (const file of files) digest.update(file.source);
    return `runtime/${digest.digest("hex").slice(0, HASH_LENGTH)}`;
  });
  return {
    name: "retrove-runtime-vendors",
    apply: "build",
    enforce: "pre",
    async resolveId(id) {
      if (
        !id.includes("/vendor/") ||
        !FILES.some((name) => name.endsWith(".mjs") && basename(id) === name)
      )
        return;
      return { id: `/${await directory}/${basename(id)}`, external: true };
    },
    async buildStart() {
      for (const { name, source } of await sources)
        this.emitFile({ type: "asset", fileName: `${await directory}/${name}`, source });
    },
  };
}
