import { describe, expect, it } from "vite-plus/test";
import { formatPattern, parsePattern } from "./date-formatter";

const UTC = { name: "GMT", offset: 0 };
const MOMENT = Date.UTC(2010, 11, 24, 18, 5, 9) / 1000;
describe("NSDateFormatter patterns", () => {
  it("formats common tokens", () => {
    expect(formatPattern("yyyy-MM-dd HH:mm:ss", MOMENT, UTC)).toBe("2010-12-24 18:05:09");
    expect(formatPattern("EEE, dd MMM yyyy HH:mm:ss 'GMT'", MOMENT, UTC)).toBe(
      "Fri, 24 Dec 2010 18:05:09 GMT",
    );
    expect(formatPattern("h:mm a", MOMENT, UTC)).toBe("6:05 PM");
    expect(formatPattern("yyyyMMdd", MOMENT, { name: "GMT-0800", offset: -28800 })).toBe(
      "20101224",
    );
  });
  it("parses numeric patterns back", () => {
    expect(parsePattern("yyyy-MM-dd HH:mm:ss", "2010-12-24 18:05:09", UTC)).toBe(MOMENT);
    expect(parsePattern("yyyy-MM-dd", "nope", UTC)).toBeUndefined();
  });
});
