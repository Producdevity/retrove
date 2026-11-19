import { execFileSync } from "node:child_process";
import { defineConfig } from "vite-plus";
import { runtimeVendors } from "./src/build/runtime-vendor-plugin";
import { offlineAssets } from "./src/build/offline-plugin";

const DEVELOPMENT_PORT = 8088;
const SOURCE_LINE_LIMIT = 300;
const FUNCTION_LINE_LIMIT = 80;
const TEST_WORKERS = 2;

export default defineConfig({
  define: {
    "import.meta.env.VITE_RETROVE_REVISION": JSON.stringify(
      execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
    ),
  },
  plugins: [runtimeVendors(), offlineAssets()],
  server: { host: "127.0.0.1", port: DEVELOPMENT_PORT, strictPort: true },
  build: {
    rolldownOptions: {
      input: {
        library: "index.html",
        player: "player.html",
        probe: "probe.html",
        "service-worker": "src/pwa/worker.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
  fmt: {
    ignorePatterns: [
      "web/**",
      "tests/**",
      "app/**",
      "scripts/**",
      "dist/**",
      ".agents/**",
      "sw.js",
    ],
  },
  lint: {
    ignorePatterns: [
      "web/**",
      "tests/**",
      "app/**",
      "scripts/**",
      "dist/**",
      ".agents/**",
      "sw.js",
    ],
    plugins: ["typescript", "import"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    options: { typeAware: true, typeCheck: true, denyWarnings: true },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-unsafe-type-assertion": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/consistent-type-imports": "error",
      eqeqeq: "error",
      "no-eval": "error",
      "no-magic-numbers": [
        "error",
        { ignore: [-1, 0, 1], ignoreArrayIndexes: false, enforceConst: true },
      ],
      "max-lines": ["error", { max: SOURCE_LINE_LIMIT, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: FUNCTION_LINE_LIMIT, skipBlankLines: true, skipComments: true },
      ],
    },
    overrides: [
      {
        files: ["**/*.test.ts"],
        rules: { "no-magic-numbers": "off", "max-lines-per-function": "off" },
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.mjs"],
    maxWorkers: TEST_WORKERS,
    server: { deps: { external: [/\/web\/vendor\//] } },
  },
});
