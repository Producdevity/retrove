import type { Diagnostic, IpaArchive } from "../../../../web/ipa.mjs";
import { prepareBioShockConfig } from "../../../../web/bioshock-config.mjs";
import profile from "./bioshock.json";
import { patchExecutable } from "./patches";
const HEXADECIMAL = 16;
const HEX_BYTE_WIDTH = 2;
export async function prepareApplication(
  ipa: IpaArchive,
  original: Uint8Array<ArrayBuffer>,
  diagnostic: Diagnostic,
): Promise<Uint8Array<ArrayBuffer>> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", original));
  const hash = [...digest]
    .map((byte) => byte.toString(HEXADECIMAL).padStart(HEX_BYTE_WIDTH, "0"))
    .join("");
  if (hash !== profile.sha256) return original;
  const bytes = patchExecutable(original, profile.groups);
  diagnostic("info", "profile", `Applied ${profile.name} compatibility profile`, {
    sha256: hash,
    groups: profile.groups.map((group) => group.name),
    patchWords: profile.groups.reduce((total, group) => total + group.words.length, 0),
  });
  await prepareBioShockConfig(ipa, diagnostic);
  return bytes;
}
