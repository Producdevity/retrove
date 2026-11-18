import { describe, expect, it } from "vite-plus/test";
import { Gauge, Gauges } from "../diagnostics/gauges";
import { GpuMemory, textureBinding, texturePart } from "./gpu-memory";

describe("GPU memory accounting", () => {
  it("replaces a level's size, sums levels and releases them on delete", () => {
    const gauges = new Gauges();
    const textures = new GpuMemory(Gauge.GpuTextureBytes, gauges);
    textures.set(3, texturePart(0x0de1, 0), 1000);
    textures.set(3, texturePart(0x0de1, 1), 250);
    textures.set(3, texturePart(0x0de1, 0), 400);
    textures.set(0, texturePart(0x0de1, 0), 99);
    expect(gauges.value(Gauge.GpuTextureBytes)).toBe(650);
    textures.drop(3);
    expect(gauges.value(Gauge.GpuTextureBytes)).toBe(0);
  });
  it("queries the cube map binding for cube faces", () => {
    expect(textureBinding(0x0de1)).toBe(0x8069);
    expect(textureBinding(0x8517)).toBe(0x8514);
  });
});
