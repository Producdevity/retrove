import { MAX_PLIST_DEPTH, type PlistValue, plistDictionary, plistInteger } from "./values";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";
const HEX = 16;
const HEX_ENTITY_PREFIX = "#x";
const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);
const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g;
const DOCTYPE = /^<!DOCTYPE\s+plist\s+PUBLIC\s+"[^"]*"\s+"[^"]*"\s*>$/i;
const ROOT = /^<plist(?:\s+version\s*=\s*["']1\.0["'])?\s*>$/i;
const ELEMENT = /^<(dict|array|string|key|integer|real|true|false|date|data)\s*(\/?)>$/;
const EMPTY_KEY = /^<key\s*\/>$/;

function unescapeXML(text: string): string {
  return text.replace(/&([^;]*);/g, (_, entity: string) => {
    const named = ENTITIES.get(entity);
    if (named !== undefined) return named;
    if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number(entity.slice(1)));
    if (/^#x[\da-f]+$/i.test(entity))
      return String.fromCodePoint(Number.parseInt(entity.slice(HEX_ENTITY_PREFIX.length), HEX));
    throw Error("Unknown XML entity in plist");
  });
}

// Workers also read IPAs, so this parses Apple's small plist vocabulary without DOMParser.
class XmlPlist {
  readonly #tokens: readonly string[];
  #cursor = 0;

  constructor(text: string) {
    this.#tokens = text.match(TOKEN) ?? [];
  }

  next(): string | undefined {
    while (this.#cursor < this.#tokens.length) {
      const token = this.#tokens[this.#cursor++] ?? "";
      if (token.startsWith("<!--") || token.startsWith("<?") || DOCTYPE.test(token)) continue;
      return token;
    }
    return undefined;
  }

  tag(): string | undefined {
    let token: string | undefined;
    do token = this.next();
    while (token !== undefined && !token.trim());
    return token;
  }

  read(open: string | undefined, depth: number): PlistValue {
    const [, name, emptyMarker] = (open === undefined ? null : ELEMENT.exec(open)) ?? [];
    if (name === undefined || depth > MAX_PLIST_DEPTH) throw Error("Invalid XML plist value");
    const empty = Boolean(emptyMarker);
    if (name === "array" || name === "dict") return this.#container(name, empty, depth);
    return scalar(name, empty ? "" : this.#text(`</${name}>`));
  }

  #container(name: "array" | "dict", empty: boolean, depth: number): PlistValue {
    const close = `</${name}>`;
    const items: PlistValue[] = [],
      pairs: [PlistValue, PlistValue][] = [];
    for (let item = empty ? close : this.tag(); item !== close; item = this.tag()) {
      if (item === undefined) throw Error("Invalid XML plist value");
      if (name === "array") {
        items.push(this.read(item, depth + 1));
        continue;
      }
      if (item !== "<key>" && !EMPTY_KEY.test(item))
        throw Error("Missing XML plist dictionary key");
      const key = this.read(item, depth + 1);
      pairs.push([key, this.read(this.tag(), depth + 1)]);
    }
    return name === "dict" ? plistDictionary(pairs) : items;
  }

  #text(close: string): string {
    let data = "";
    for (let token = this.next(); token !== close; token = this.next()) {
      if (token?.startsWith(CDATA_OPEN))
        data += token.slice(CDATA_OPEN.length, -CDATA_CLOSE.length);
      else if (token === undefined || token.startsWith("<"))
        throw Error("Invalid XML plist scalar");
      else data += unescapeXML(token);
    }
    return data;
  }
}

function scalar(name: string, data: string): PlistValue {
  switch (name) {
    case "true":
      return true;
    case "false":
      return false;
    case "integer":
      return plistInteger(BigInt(data.trim()));
    case "real":
      return Number(data.trim());
    case "date":
      return new Date(data.trim());
    case "data":
      return Uint8Array.from(atob(data.replace(/\s/g, "")), (character) => character.charCodeAt(0));
    default:
      return data;
  }
}

export function parseXmlPlist(bytes: Uint8Array): PlistValue {
  const plist = new XmlPlist(utf8.decode(bytes));
  const wrapper = plist.tag();
  if (wrapper === undefined || !ROOT.test(wrapper)) throw Error("Missing XML plist root");
  const result = plist.read(plist.tag(), 0);
  if (plist.tag() !== "</plist>" || plist.tag() !== undefined)
    throw Error("Invalid XML plist trailer");
  return result;
}
