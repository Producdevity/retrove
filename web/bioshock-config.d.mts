import type { IpaArchive, Diagnostic } from "./ipa.mjs";
import type { SaveStorage } from "../src/runtime/storage/save-storage";
export function prepareBioShockConfig(ipa: IpaArchive, diagnostic: Diagnostic, storage?: SaveStorage): Promise<void>;
