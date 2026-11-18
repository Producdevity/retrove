/** CFStringEncoding values with their NSStringEncoding and IANA names. */
export const CFEncoding = {
  MacRoman: 0,
  WindowsLatin1: 0x0500,
  ISOLatin1: 0x0201,
  ASCII: 0x0600,
  Unicode: 0x0100,
  UTF8: 0x08000100,
  UTF16BE: 0x10000100,
  UTF16LE: 0x14000100,
  Invalid: 0xffffffff,
} as const;
/** NSStringEncoding values for the encodings above. */
const NSEncoding = {
  ASCII: 1,
  UTF8: 4,
  ISOLatin1: 5,
  Unicode: 10,
  WindowsCP1252: 12,
  MacRoman: 30,
  UTF16BE: 0x90000100,
  UTF16LE: 0x94000100,
} as const;
/** NSStringEncoding values outside this table are the CF value with the high bit set. */
const NS_FOREIGN_FLAG = 0x80000000;
const KNOWN: readonly { cf: number; ns: number; iana: string }[] = [
  { cf: CFEncoding.ASCII, ns: NSEncoding.ASCII, iana: "us-ascii" },
  { cf: CFEncoding.UTF8, ns: NSEncoding.UTF8, iana: "utf-8" },
  { cf: CFEncoding.ISOLatin1, ns: NSEncoding.ISOLatin1, iana: "iso-8859-1" },
  { cf: CFEncoding.Unicode, ns: NSEncoding.Unicode, iana: "utf-16" },
  { cf: CFEncoding.WindowsLatin1, ns: NSEncoding.WindowsCP1252, iana: "windows-1252" },
  { cf: CFEncoding.MacRoman, ns: NSEncoding.MacRoman, iana: "macintosh" },
  { cf: CFEncoding.UTF16BE, ns: NSEncoding.UTF16BE, iana: "utf-16be" },
  { cf: CFEncoding.UTF16LE, ns: NSEncoding.UTF16LE, iana: "utf-16le" },
];
const ALIASES: Readonly<Record<string, number>> = {
  ascii: CFEncoding.ASCII,
  utf8: CFEncoding.UTF8,
  latin1: CFEncoding.ISOLatin1,
  "iso-latin-1": CFEncoding.ISOLatin1,
  "x-mac-roman": CFEncoding.MacRoman,
  cp1252: CFEncoding.WindowsLatin1,
};

export function nsEncodingFor(cf: number): number {
  return KNOWN.find((entry) => entry.cf === cf)?.ns ?? (cf | NS_FOREIGN_FLAG) >>> 0;
}
export function cfEncodingFor(ns: number): number {
  const known = KNOWN.find((entry) => entry.ns === ns);
  if (known) return known.cf;
  return ns & NS_FOREIGN_FLAG ? (ns & ~NS_FOREIGN_FLAG) >>> 0 : CFEncoding.Invalid;
}
export function ianaNameFor(cf: number): string | undefined {
  return KNOWN.find((entry) => entry.cf === cf)?.iana;
}
export function encodingForIanaName(name: string): number {
  const key = name.trim().toLowerCase();
  return KNOWN.find((entry) => entry.iana === key)?.cf ?? ALIASES[key] ?? CFEncoding.Invalid;
}

/** CFStringGetIntValue: leading whitespace, an optional sign and digits; 0 when none. */
export function leadingInteger(text: string): number {
  const match = /^\s*([+-]?\d+)/u.exec(text);
  return match?.[1] ? Number.parseInt(match[1], 10) | 0 : 0;
}

const HEX = 16;
const BYTE_DIGITS = 2;
const ESCAPE = /(?:%[\da-f]{2})+/giu;
/**
 * CFURLCreateStringByReplacingPercentEscapes: `leave` undefined replaces nothing; escapes that
 * decode to a character in `leave` stay escaped. Undefined when the bytes are not valid text.
 */
export function replacePercentEscapes(
  text: string,
  leave: string | undefined,
  cf: number = CFEncoding.UTF8,
): string | undefined {
  if (leave === undefined) return text;
  const label = cf === CFEncoding.UTF8 ? "utf-8" : ianaNameFor(cf);
  if (!label) return undefined;
  const decoder = new TextDecoder(label === "us-ascii" ? "windows-1252" : label, { fatal: true });
  let failed = false;
  const result = text.replace(ESCAPE, (run) => {
    const bytes = Uint8Array.from(run.slice(1).split("%"), (pair) => Number.parseInt(pair, HEX));
    try {
      const decoded = decoder.decode(bytes);
      if (!leave) return decoded;
      return Array.from(decoded)
        .map((character) =>
          leave.includes(character)
            ? Array.from(
                new TextEncoder().encode(character),
                (byte) => `%${byte.toString(HEX).toUpperCase().padStart(BYTE_DIGITS, "0")}`,
              ).join("")
            : character,
        )
        .join("");
    } catch {
      failed = true;
      return run;
    }
  });
  return failed ? undefined : result;
}
