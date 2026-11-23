import { installBundleDirectories } from "../foundation/bundle";
import { bundleStrings } from "../foundation/localized-strings";
import type { ObjcCore } from "./core";
import { Argument } from "./host";

const BUNDLE = "NSBundle";
const DEFAULT_TABLE = "Localizable";
/** NSBundle for the application bundle; the guest sees its files under `/`. */
export function installBundleMethods(core: ObjcCore): void {
  const { registry, ownership, strings, ipa, late } = core;
  const { method } = registry;
  const { text, string } = strings;
  let bundle: number | undefined;
  const mainBundle = () => (bundle ??= ownership.alloc(registry.names.get(BUNDLE) ?? 0));
  method(BUNDLE, true, "mainBundle", mainBundle);
  method(BUNDLE, true, "bundleForClass:", (_, args) =>
    registry.classes.has(args(0)) ? mainBundle() : 0,
  );
  for (const name of ["bundlePath", "resourcePath"])
    method(BUNDLE, false, name, () => string(`/${ipa.bundlePath}`));
  method(BUNDLE, false, "loadNibNamed:owner:options:", (self, args) =>
    late.nibs().named(text(args(0)), args(1), self),
  );
  method(BUNDLE, false, "bundleIdentifier", () => {
    const identifier = ipa.info["CFBundleIdentifier"];
    if (!identifier) return 0;
    return string(typeof identifier === "string" ? identifier : JSON.stringify(identifier));
  });
  method(BUNDLE, false, "executablePath", () => string(`/${ipa.executablePath}`));
  const localized = bundleStrings(ipa);
  method(BUNDLE, false, "localizedStringForKey:value:table:", async (_, args) => {
    const [key, fallback, table] = [
      args(Argument.First),
      args(Argument.Second),
      args(Argument.Third),
    ];
    if (!key) return 0;
    const result = await localized(text(key), (table && text(table)) || DEFAULT_TABLE);
    return result === undefined
      ? ownership.autorelease(ownership.retain(fallback && text(fallback) ? fallback : key))
      : string(result);
  });
  method(BUNDLE, false, "pathForResource:ofType:", (_, args) => {
    if (!args(0)) return 0;
    const name = text(args(0)),
      extension = args(1) ? text(args(1)) : "";
    const path = `${ipa.bundlePath}/${name}${extension ? `.${extension}` : ""}`;
    return ipa.has(path) ? string(`/${path}`) : 0;
  });
  installBundleDirectories({ method, text, string, send: core.messenger.send });
}
