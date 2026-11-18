import { describe, expect, it } from "vite-plus/test";
import {
  CFEncoding,
  cfEncodingFor,
  encodingForIanaName,
  ianaNameFor,
  leadingInteger,
  nsEncodingFor,
  replacePercentEscapes,
} from "./string-encodings";

describe("string encodings", () => {
  it("maps CF and NS encodings both ways", () => {
    expect(nsEncodingFor(CFEncoding.UTF8)).toBe(4);
    expect(cfEncodingFor(4)).toBe(CFEncoding.UTF8);
    expect(nsEncodingFor(0x0a02)).toBe(0x80000a02);
    expect(cfEncodingFor(0x80000a02)).toBe(0x0a02);
    expect(cfEncodingFor(99)).toBe(CFEncoding.Invalid);
  });
  it("names encodings in IANA terms", () => {
    expect(ianaNameFor(CFEncoding.UTF8)).toBe("utf-8");
    expect(encodingForIanaName("UTF-8")).toBe(CFEncoding.UTF8);
    expect(encodingForIanaName("latin1")).toBe(CFEncoding.ISOLatin1);
    expect(encodingForIanaName("klingon")).toBe(CFEncoding.Invalid);
  });
  it("reads a leading integer", () => {
    expect(leadingInteger("  -42abc")).toBe(-42);
    expect(leadingInteger("abc")).toBe(0);
  });
  it("replaces percent escapes", () => {
    expect(replacePercentEscapes("a%20b%C3%A9", "")).toBe("a bé");
    expect(replacePercentEscapes("a%2Fb%20c", "/")).toBe("a%2Fb c");
    expect(replacePercentEscapes("a%20b", undefined)).toBe("a%20b");
    expect(replacePercentEscapes("%FF", "")).toBeUndefined();
    expect(replacePercentEscapes("%E9", "", CFEncoding.ISOLatin1)).toBe("é");
  });
});
