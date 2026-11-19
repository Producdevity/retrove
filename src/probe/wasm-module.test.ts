import { describe, expect, it } from "vite-plus/test";
import { syntheticModule } from "./wasm-module";

describe("probe module", () => {
  it("is a valid module with the requested function count", async () => {
    const bytes = syntheticModule(300);
    expect(WebAssembly.validate(bytes)).toBe(true);
    const module = await WebAssembly.compile(bytes);
    expect(module).toBeInstanceOf(WebAssembly.Module);
  });
});
