import { decodeText, StringEncoding } from "../text/encoding";
import { XMLLimit, XMLError, XMLParseFailure } from "./types";
const HEADER_BYTES = 256;
const ByteOrderMark = { High: 0xfe, Low: 0xff } as const;
const LESS_THAN = "<".charCodeAt(0),
  QUESTION_MARK = "?".charCodeAt(0);
const UTF16LE_BOM = [ByteOrderMark.Low, ByteOrderMark.High] as const,
  UTF16BE_BOM = [ByteOrderMark.High, ByteOrderMark.Low] as const;
const UTF16LE_XML = [LESS_THAN, 0, QUESTION_MARK, 0] as const,
  UTF16BE_XML = [0, LESS_THAN, 0, QUESTION_MARK] as const;
function starts(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}
export function decodeXML(bytes: Uint8Array): string {
  if (bytes.length > XMLLimit.Bytes)
    throw new XMLParseFailure(XMLError.Internal, "XML document exceeds the input byte limit.");
  if (!bytes.length) throw new XMLParseFailure(XMLError.Empty, "XML document is empty.");
  const header = Array.from(bytes.subarray(0, HEADER_BYTES), (byte) =>
    String.fromCharCode(byte),
  ).join("");
  let encoding =
    /^<\?xml\s[^?]*?encoding\s*=\s*['"](?<encoding>[^'"]+)['"]/i.exec(header)?.groups?.encoding ??
    "utf-8";
  if (starts(bytes, UTF16LE_BOM) || starts(bytes, UTF16LE_XML)) encoding = "utf-16le";
  if (starts(bytes, UTF16BE_BOM) || starts(bytes, UTF16BE_XML)) encoding = "utf-16be";
  try {
    const value = /^(iso-8859-1|latin1)$/i.test(encoding)
      ? decodeText(bytes, StringEncoding.Latin1)
      : new TextDecoder(encoding, { fatal: true }).decode(bytes);
    if (value === null) throw new Error("Invalid XML text encoding.");
    return value;
  } catch {
    throw new XMLParseFailure(
      XMLError.Encoding,
      "Invalid or unsupported XML text encoding: " + encoding,
    );
  }
}
