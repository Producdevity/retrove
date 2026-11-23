import { createCore } from "./core";
import { createUrls } from "./helper-urls";
import { createValues } from "./helper-values";
import type { FoundationBase, Helpers } from "./types";

export function createHelpers(base: FoundationBase): Helpers {
  const core = createCore(base);
  const values = createValues(base, core);
  const urls = createUrls(base, core);
  return {
    bits: new DataView(new ArrayBuffer(Float64Array.BYTES_PER_ELEMENT)),
    ...core,
    ...values,
    ...urls,
  };
}
