import { describe, expect, it } from "vite-plus/test";
import { drawSwitch, type SwitchCanvas } from "./switch";

function recorder() {
  const calls: string[] = [];
  const context: SwitchCanvas = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    save: () => undefined,
    restore: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: (x: number) => void calls.push(`arc ${x}`),
    closePath: () => undefined,
    fill: () =>
      void calls.push(
        `fill ${typeof context.fillStyle === "string" ? context.fillStyle : "pattern"}`,
      ),
    stroke: () => undefined,
    fillText: (text: string) => void calls.push(`text ${text}`),
  };
  return { context, calls };
}

describe("UISwitch drawing", () => {
  it("puts the knob on the right with ON in the tint when on", () => {
    const { context, calls } = recorder();
    drawSwitch(context, [0, 0, 94, 27], true, true, "red");
    expect(calls).toContain("fill red");
    expect(calls).toContain("text ON");
    expect(calls.at(-2)).toBe("arc 80.5");
  });
  it("puts the knob on the left with OFF when off", () => {
    const { context, calls } = recorder();
    drawSwitch(context, [0, 0, 94, 27], false, true, undefined);
    expect(calls).toContain("text OFF");
    expect(calls.at(-2)).toBe("arc 13.5");
  });
});
