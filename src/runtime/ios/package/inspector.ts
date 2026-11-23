import { DiagnosticOperation, observed } from "../../../diagnostics/operations";
import { openIPA } from "./ipa";
import { parseMachO } from "../macho/macho";
import { Platform, type ApplicationMetadata } from "../../../domain/application";
import { requiredString } from "../../../domain/validation";
import { extractIcon } from "./icon";

export async function inspectIpa(
  file: File,
  signal: AbortSignal,
  report: (error: unknown) => void,
): Promise<ApplicationMetadata> {
  const ipa = await observed(DiagnosticOperation.InspectPackage, () => openIPA(file));
  signal.throwIfAborted();
  await observed(DiagnosticOperation.InspectExecutable, async () =>
    parseMachO(await ipa.readExecutable()),
  );
  signal.throwIfAborted();
  const info = ipa.info;
  const bundleId = requiredString(info.CFBundleIdentifier, "bundle identifier");
  const name = requiredString(
    info.CFBundleDisplayName ?? info.CFBundleName ?? info.CFBundleExecutable,
    "app name",
  );
  const version = info.CFBundleShortVersionString ?? info.CFBundleVersion ?? "";
  if (typeof version !== "string") throw new Error("The app's version is invalid.");
  let icon: Blob | null = null;
  try {
    icon = await extractIcon(ipa);
  } catch (error) {
    report(new Error("The app was imported without its unreadable icon.", { cause: error }));
  }
  return { platform: Platform.IOS, bundleId, name, version, icon };
}
