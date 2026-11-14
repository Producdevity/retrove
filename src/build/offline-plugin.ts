import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { Plugin } from "vite-plus";
const STATIC_FILES = [
  "app.webmanifest",
  "icons/icon.svg",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
] as const;
const SERVICE_WORKER = "sw.js";
const SOURCE_ARCHIVE_LIMIT = 33_554_432;
const SOURCE_ARCHIVE = "source.tar.gz";
function sourceArchive(): Uint8Array {
  const files = execFileSync("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return execFileSync("tar", ["-czf", "-", "--null", "-T", "-"], {
    input:
      files
        .toString("utf8")
        .split("\0")
        .filter((path) => path && existsSync(path))
        .join("\0") + "\0",
    maxBuffer: SOURCE_ARCHIVE_LIMIT,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
}
export function offlineAssets(): Plugin {
  return {
    name: "retrove-offline-assets",
    apply: "build",
    generateBundle: {
      order: "post",
      async handler(_options, bundle) {
        for (const path of STATIC_FILES) {
          const source = await readFile(path);
          this.emitFile({ type: "asset", fileName: path, source });
        }
        const assets = [...STATIC_FILES.map((path) => `/${path}`)];
        const version = createHash("sha256");
        for (const [filename, output] of Object.entries(bundle).sort(([left], [right]) =>
          left.localeCompare(right),
        )) {
          if (filename === SERVICE_WORKER) continue;
          assets.push(`/${filename}`);
          version.update(filename).update(output.type === "chunk" ? output.code : output.source);
        }
        for (const path of STATIC_FILES) version.update(await readFile(path));
        const worker = bundle[SERVICE_WORKER];
        if (!worker || worker.type !== "chunk")
          throw new Error("The offline worker was not built.");
        version.update(worker.code);
        worker.code = worker.code
          .replaceAll("__RETROVE_ASSETS__", JSON.stringify(assets))
          .replaceAll("__RETROVE_VERSION__", JSON.stringify(version.digest("hex")));
        this.emitFile({ type: "asset", fileName: SOURCE_ARCHIVE, source: sourceArchive() });
        this.emitFile({
          type: "asset",
          fileName: "_headers",
          source:
            "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n/sw.js\n  Cache-Control: no-cache\n",
        });
      },
    },
  };
}
