import type { IpaArchive } from "../../../../../web/ipa.mjs";
const RETINA_SCALE = 2;
interface ImageFiles {
  readonly ipa: Pick<IpaArchive, "bundlePath" | "has" | "read">;
  contents(path: string): Promise<Uint8Array | undefined>;
}
export async function imageFile(
  host: ImageFiles,
  input: string,
  named: boolean,
): Promise<{ bytes: Uint8Array; path: string; scale: number } | undefined> {
  let path = input,
    bytes: Uint8Array | undefined;
  if (named) {
    const prefix = host.ipa.bundlePath + "/";
    path = path.replace(/^\/+/, "");
    if (!path.startsWith(prefix)) path = prefix + path;
    const dot = path.lastIndexOf("."),
      slash = path.lastIndexOf("/"),
      extension = dot > slash ? path.slice(dot) : ".png",
      base = dot > slash ? path.slice(0, dot) : path;
    const candidates = [
      base + "@2x~iphone" + extension,
      base + "@2x" + extension,
      base + "~iphone" + extension,
      base + extension,
    ];
    const entry = candidates.find((candidate) => host.ipa.has(candidate));
    if (!entry) return;
    path = entry;
    bytes = await host.ipa.read(entry);
  } else bytes = await host.contents(path);
  if (!bytes) return;
  return { path, bytes, scale: /@2x(?:~[^.]*)?\./.test(path) ? RETINA_SCALE : 1 };
}
