import { describe, expect, it } from "vite-plus/test";
import { Orientation, turnFor } from "./orientation";

describe("turnFor", () => {
  it("turns a landscape choice on an upright screen", () => {
    expect(turnFor(Orientation.Landscape, true)).toBe("90");
    expect(turnFor(Orientation.Landscape, false)).toBe("");
  });
  it("turns a portrait choice on a sideways screen", () => {
    expect(turnFor(Orientation.Portrait, false)).toBe("-90");
    expect(turnFor(Orientation.Portrait, true)).toBe("");
  });
  it("never turns in automatic mode", () => {
    expect(turnFor(Orientation.Auto, true)).toBe("");
    expect(turnFor(Orientation.Auto, false)).toBe("");
  });
});
