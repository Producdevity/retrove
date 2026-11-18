import { describe, expect, it } from "vite-plus/test";
import { abbreviatedZone, fixedZone, namedZone, offsetForZone } from "./zone";

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

describe("named time zones", () => {
  it("resolves Foundation abbreviations to their region", () => {
    expect(abbreviatedZone("PST")).toEqual({ name: "America/Los_Angeles" });
    expect(abbreviatedZone("pdt")?.name).toBe("America/Los_Angeles");
    expect(namedZone("America/New_York")).toEqual({ name: "America/New_York" });
    expect(namedZone("XYZ")).toBeUndefined();
    expect(offsetForZone(abbreviatedZone("PST") ?? fixedZone(0), Date.UTC(2026, 0, 1) / 1000)).toBe(
      -28800,
    );
  });
});
