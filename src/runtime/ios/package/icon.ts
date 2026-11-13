import { decodeCgBI } from "../../../../web/cgbi.mjs";
import type { IpaArchive } from "../../../../web/ipa.mjs";
import { isRecord } from "../../../domain/validation";
const PNG_MIME = "image/png";
const ICON_READ_LIMIT = 8_388_608;

function iconNames(info: Record<string, unknown>): string[] {
  const icons = info.CFBundleIcons;
  const primary = isRecord(icons) ? icons.CFBundlePrimaryIcon : undefined;
  const declared =
    (isRecord(primary) ? primary.CFBundleIconFiles : undefined) ?? info.CFBundleIconFiles;
  if (Array.isArray(declared))
    return declared.filter((value): value is string => typeof value === "string");
  return [typeof info.CFBundleIconFile === "string" ? info.CFBundleIconFile : "Icon"];
}

export async function extractIcon(ipa: IpaArchive): Promise<Blob | null> {
  const names = iconNames(ipa.info);
  const candidates = [...ipa.entries.keys()].filter(
    (path) =>
      /\.png$/i.test(path) &&
      names.some((name) => path.startsWith(`${ipa.bundlePath}/${name.replace(/\.png$/i, "")}`)),
  );
  candidates.sort((left, right) => Number(right.includes("@2x")) - Number(left.includes("@2x")));
  const path = candidates[0];
  if (!path) return null;
  const bytes = await ipa.read(path, { maxBytes: ICON_READ_LIMIT });
  const decoded = decodeCgBI(bytes);
  if (!decoded) return new Blob([bytes], { type: PNG_MIME });
  const canvas = document.createElement("canvas");
  canvas.width = decoded.width;
  canvas.height = decoded.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(new ImageData(decoded.rgba, decoded.width, decoded.height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, PNG_MIME));
}
