import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { build, type Plugin } from "vite-plus";
import { ExecutionMessage, type ExecutionPort } from "../protocol";

const ENTRY = "retrove-node-execution-worker";
const RESOLVED = "\0" + ENTRY;

/** Bundles a worker entry that serves the given module's `serve` export over `parentPort`. */
export async function bundleNodeWorker(module: URL, serve: string): Promise<string> {
  const path = JSON.stringify(fileURLToPath(module));
  const entry: Plugin = {
    name: ENTRY,
    enforce: "pre",
    resolveId: (id) => (id.endsWith(ENTRY) ? RESOLVED : undefined),
    load: (id) =>
      id === RESOLVED
        ? `import { parentPort } from "node:worker_threads";
import { ${serve} as serve } from ${path};
serve({ post: (message) => parentPort.postMessage(message), listen: (handler) => parentPort.on("message", handler) });`
        : undefined,
  };
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [entry],
    build: {
      write: false,
      minify: false,
      lib: { entry: ENTRY, formats: ["es"], fileName: "worker" },
      rolldownOptions: { external: [/^node:/] },
    },
  });
  for (const output of Array.isArray(result) ? result : [result])
    if ("output" in output)
      for (const chunk of output.output) if (chunk.type === "chunk") return chunk.code;
  throw new Error("The worker bundle has no chunk.");
}

/** An execution worker on node's worker_threads running a bundle from `bundleNodeWorker`. */
export function nodeExecutionPort(code: string): ExecutionPort {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(code)}`));
  return {
    post: (message, transfer = []) => {
      // Tests stand in for the display canvas with an ArrayBuffer.
      worker.postMessage(
        message,
        transfer.filter((item) => item instanceof ArrayBuffer),
      );
    },
    listen: (handler) => {
      worker.on("message", handler);
      worker.on("error", (error) => {
        handler({ type: ExecutionMessage.Failed, message: String(error) });
      });
    },
    terminate: () => {
      void worker.terminate();
    },
  };
}
