import { describe, expect, it } from "vite-plus/test";
import { formatNumber, parseNumber } from "./number-formatter";

const state = (style: number) => ({
  style,
  minimumFraction: undefined,
  maximumFraction: undefined,
  grouping: undefined,
  currency: "USD",
});
describe("NSNumberFormatter", () => {
  it("formats plain and decimal styles", () => {
    expect(formatNumber(state(0), 1234.5)).toMatch(/^1234(\.5)?$|^1235$/u);
    expect(formatNumber(state(1), 1234.5)).toMatch(/1.234.5|1,234.5/u);
  });
  it("parses percent strings as fractions", () => {
    expect(parseNumber(state(3), "45%")).toBeCloseTo(0.45);
    expect(parseNumber(state(1), "1,234")).toBe(1234);
    expect(parseNumber(state(1), "abc")).toBeUndefined();
  });
});
