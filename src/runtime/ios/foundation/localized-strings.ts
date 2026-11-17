import { isBinaryPlist, parsePlist } from "../../formats/plist";

type StringTable = ReadonlyMap<string, string>;
export interface LocalizedBundle {
  readonly info: Readonly<Record<string, unknown>>;
  readonly bundlePath: string;
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array>;
}
const BomByte = { High: 0xff, Low: 0xfe } as const;
const STRINGS_TOKEN = /"(?:[^"\\]|\\[\s\S])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[=;]|[^\s=;]+/g;
const ESCAPE = /\\(?:U([0-9a-fA-F]{4})|([0-7]{1,3})|([\s\S]))/g;
const CONTROL_ESCAPES = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
]);
const HEX = 16;
const OCTAL = 8;
const ENTRY_TOKENS = 4;
const Entry = { Key: 0, Equals: 1, Value: 2, End: 3 } as const;

function encoding(bytes: Uint8Array): string {
  const [first, second] = bytes;
  if (first === BomByte.High && second === BomByte.Low) return "utf-16le";
  if (first === BomByte.Low && second === BomByte.High) return "utf-16be";
  return "utf-8";
}

function literal(token: string): string {
  if (!token.startsWith('"')) return token;
  return token
    .slice(1, -1)
    .replace(ESCAPE, (_, unicode?: string, octal?: string, character?: string) => {
      if (unicode) return String.fromCharCode(Number.parseInt(unicode, HEX));
      if (octal) return String.fromCharCode(Number.parseInt(octal, OCTAL));
      return CONTROL_ESCAPES.get(character ?? "") ?? character ?? "";
    });
}

function plistTable(bytes: Uint8Array): StringTable {
  const value = parsePlist(bytes);
  const table = new Map<string, string>();
  if (value && typeof value === "object" && !Array.isArray(value) && !ArrayBuffer.isView(value))
    for (const [key, entry] of Object.entries(value))
      if (typeof entry === "string") table.set(key, entry);
  return table;
}

export function parseStringsTable(bytes: Uint8Array): StringTable {
  if (isBinaryPlist(bytes)) return plistTable(bytes);
  const source = new TextDecoder(encoding(bytes)).decode(bytes);
  if (source.trimStart().startsWith("<")) return plistTable(new TextEncoder().encode(source));
  const values = (source.match(STRINGS_TOKEN) ?? []).filter(
    (token) => !token.startsWith("/*") && !token.startsWith("//"),
  );
  const table = new Map<string, string>();
  for (let index = 0; index < values.length; index += ENTRY_TOKENS) {
    const key = values[index + Entry.Key],
      value = values[index + Entry.Value];
    if (
      key === undefined ||
      value === undefined ||
      values[index + Entry.Equals] !== "=" ||
      values[index + Entry.End] !== ";"
    )
      throw Error("Malformed .strings table");
    table.set(literal(key), literal(value));
  }
  return table;
}

export function bundleStrings(bundle: LocalizedBundle) {
  const tables = new Map<string, Promise<StringTable>>();
  async function load(name: string): Promise<StringTable> {
    const preferred = globalThis.navigator?.languages ?? ["en"];
    const locales = new Set(
      preferred.flatMap((language) => [language, language.split("-")[0] ?? language]),
    );
    const development = bundle.info["CFBundleDevelopmentRegion"];
    for (const language of [development, "en", "English", "Base", ""])
      if (typeof language === "string") locales.add(language);
    for (const language of locales) {
      const path = `${bundle.bundlePath}/${language ? `${language}.lproj/` : ""}${name}.strings`;
      if (bundle.has(path)) return parseStringsTable(await bundle.read(path));
    }
    return new Map();
  }
  return async (key: string, name = "Localizable"): Promise<string | undefined> => {
    if (/[\\/]/.test(name) || name === "..") throw Error("Invalid bundle string table name");
    let table = tables.get(name);
    if (!table) tables.set(name, (table = load(name)));
    return (await table).get(key);
  };
}
