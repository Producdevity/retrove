import { expect, test } from "vite-plus/test";
import { headersFile } from "./headers-file";

test("the hosting headers isolate every path and keep the worker uncached", () => {
  expect(headersFile()).toBe(
    [
      "/*",
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: no-referrer",
      "  Cross-Origin-Opener-Policy: same-origin",
      "  Cross-Origin-Embedder-Policy: require-corp",
      "  Cross-Origin-Resource-Policy: same-origin",
      "/sw.js",
      "  Cache-Control: no-cache",
      "",
    ].join("\n"),
  );
});
