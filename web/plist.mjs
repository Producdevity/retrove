import {ArchiveReference} from "../src/runtime/ios/foundation/archives/graph.ts";
const utf8 = new TextDecoder("utf-8", { fatal: true });
const utf16be = new TextDecoder("utf-16be", { fatal: true });

function dictionary(pairs) {
  const result = Object.create(null);
  for (const [key, value] of pairs) {
    if (typeof key !== "string" || Object.hasOwn(result, key)) throw Error("Invalid plist dictionary key");
    result[key] = value;
  }
  return result;
}

function binaryPlist(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trailer = bytes.length - 32;
  if (trailer < 8) throw Error("Missing binary plist trailer");

  function uint(at, width, end = bytes.length) {
    if (width < 1 || width > 8 || at < 0 || at + width > end) throw Error("Invalid binary plist integer");
    let value = 0;
    for (let i = 0; i < width; i++) value = value * 256 + bytes[at + i];
    if (!Number.isSafeInteger(value)) throw Error("Binary plist offset exceeds integer precision");
    return value;
  }

  const offsetSize = bytes[trailer + 6];
  const refSize = bytes[trailer + 7];
  const count = uint(trailer + 8, 8);
  const root = uint(trailer + 16, 8);
  const table = uint(trailer + 24, 8);
  if (!offsetSize || offsetSize > 8 || !refSize || refSize > 8 ||
      table < 8 || count > (trailer - table) / offsetSize || root >= count) {
    throw Error("Invalid binary plist object table");
  }

  const decoded = new Map();
  const visiting = new Set();
  function read(ref) {
    if (decoded.has(ref)) return decoded.get(ref);
    if (ref >= count || visiting.has(ref) || visiting.size >= 128) throw Error("Invalid binary plist reference");
    visiting.add(ref);
    let at = uint(table + ref * offsetSize, offsetSize, trailer);
    if (at < 8 || at >= table) throw Error("Invalid binary plist object offset");
    const marker = bytes[at++];
    const kind = marker >>> 4;
    const arg = marker & 15;
    function size() {
      if (arg < 15) return arg;
      if (at >= table || (bytes[at] >>> 4) !== 1) throw Error("Missing binary plist length");
      const width = 2 ** (bytes[at++] & 15);
      const value = uint(at, width, table);
      at += width;
      return value;
    }
    function take(n) {
      if (!Number.isSafeInteger(n) || n > table - at) throw Error("Truncated binary plist object");
      const start = at;
      at += n;
      return start;
    }
    let value;
    switch (kind) {
      case 0:
        if (arg !== 0 && arg !== 8 && arg !== 9) throw Error("Unsupported binary plist scalar");
        value = arg === 0 ? null : arg === 9;
        break;
      case 1: {
        const width = 2 ** arg;
        if (width > 16) throw Error("Unsupported binary plist integer width");
        const start = take(width);
        let integer = 0n;
        for (const byte of bytes.subarray(start, at)) integer = (integer << 8n) + BigInt(byte);
        if (width >= 8) integer = BigInt.asIntN(width * 8, integer);
        value = Number.isSafeInteger(Number(integer)) ? Number(integer) : integer;
        break;
      }
      case 2:
        if (arg === 2) value = view.getFloat32(take(4));
        else if (arg === 3) value = view.getFloat64(take(8));
        else throw Error("Unsupported binary plist real width");
        break;
      case 3:
        if (arg !== 3) throw Error("Unsupported binary plist date");
        value = new Date(Date.UTC(2001, 0, 1) + 1000 * view.getFloat64(take(8)));
        break;
      case 4: case 5: case 6: case 7: {
        const length = size();
        const start = take(kind === 6 ? length * 2 : length);
        const payload = bytes.subarray(start, at);
        value = kind === 4 ? payload : (kind === 6 ? utf16be : utf8).decode(payload);
        break;
      }
      case 8:
        value = new ArchiveReference(uint(take(arg + 1), arg + 1, table));
        break;
      case 10: case 12: case 13: {
        const length = size();
        const start = take(length * refSize * (kind === 13 ? 2 : 1));
        const element = i => read(uint(start + i * refSize, refSize, table));
        value = kind === 13
          ? dictionary(Array.from({ length }, (_, i) => [element(i), element(length + i)]))
          : Array.from({ length }, (_, i) => element(i));
        break;
      }
      default: throw Error("Unsupported binary plist object type " + kind);
    }
    visiting.delete(ref);
    decoded.set(ref, value);
    return value;
  }
  return read(root);
}

const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescapeXML(text) {
  return text.replace(/&([^;]*);/g, (_, entity) => {
    if (Object.hasOwn(entities, entity)) return entities[entity];
    if (/^#\d+$/.test(entity)) return String.fromCodePoint(Number(entity.slice(1)));
    if (/^#x[\da-f]+$/i.test(entity)) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    throw Error("Unknown XML entity in plist");
  });
}

function xmlPlist(bytes) {
  const text = utf8.decode(bytes);
  // Workers also read IPAs. Parse Apple's small plist vocabulary without DOMParser.
  const tokens = text.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) ?? [];
  let cursor = 0;
  function next() {
    while (cursor < tokens.length) {
      const token = tokens[cursor++];
      if (token.startsWith("<!--") || token.startsWith("<?") ||
          /^<!DOCTYPE\s+plist\s+PUBLIC\s+"[^"]*"\s+"[^"]*"\s*>$/i.test(token)) continue;
      return token;
    }
  }
  function tag() {
    let token;
    do { token = next(); } while (token !== undefined && !token.trim());
    return token;
  }
  const wrapper = tag();
  if (!/^<plist(?:\s+version\s*=\s*["']1\.0["'])?\s*>$/i.test(wrapper)) throw Error("Missing XML plist root");
  function read(open, depth) {
    const match = /^<(dict|array|string|key|integer|real|true|false|date|data)\s*(\/?)>$/.exec(open);
    if (!match || depth > 128) throw Error("Invalid XML plist value");
    const [, name, empty] = match;
    const close = "</" + name + ">";
    if (name === "array" || name === "dict") {
      const values = [];
      if (!empty) {
        let item;
        while ((item = tag()) !== close) {
          if (name === "dict") {
            if (item !== "<key>" && !/^<key\s*\/>$/.test(item)) throw Error("Missing XML plist dictionary key");
            const key = read(item, depth + 1);
            values.push([key, read(tag(), depth + 1)]);
          } else values.push(read(item, depth + 1));
        }
      }
      return name === "dict" ? dictionary(values) : values;
    }
    let data = "";
    if (!empty) {
      let token;
      while ((token = next()) !== close) {
        if (token?.startsWith("<![CDATA[")) data += token.slice(9, -3);
        else if (token === undefined || token.startsWith("<")) throw Error("Invalid XML plist scalar");
        else data += unescapeXML(token);
      }
    }
    switch (name) {
      case "key": case "string": return data;
      case "true": return true;
      case "false": return false;
      case "integer": {
        const integer = BigInt(data.trim());
        return Number.isSafeInteger(Number(integer)) ? Number(integer) : integer;
      }
      case "real": return Number(data.trim());
      case "date": return new Date(data.trim());
      case "data": return Uint8Array.from(atob(data.replace(/\s/g, "")), c => c.charCodeAt(0));
    }
  }
  const result = read(tag(), 0);
  if (tag() !== "</plist>" || tag() !== undefined) throw Error("Invalid XML plist trailer");
  return result;
}

export function parsePlist(bytes) {
  return String.fromCharCode(...bytes.subarray(0, 8)) === "bplist00" ? binaryPlist(bytes) : xmlPlist(bytes);
}
