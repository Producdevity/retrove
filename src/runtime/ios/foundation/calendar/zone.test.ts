import { describe, expect, it } from "vite-plus/test";
import { fixedZone, offsetForZone } from "./zone";

describe("fixed-offset time zones", () => {
  it("names zones as Foundation does", () => {
    expect(fixedZone(-28800)).toEqual({ name: "GMT-0800", offset: -28800 });
    expect(fixedZone(19800).name).toBe("GMT+0530");
    expect(fixedZone(0)).toEqual({ name: "GMT", offset: 0 });
  });
  it("keeps the fixed offset regardless of date", () => {
    expect(offsetForZone(fixedZone(-28800), 0)).toBe(-28800);
  });
});
