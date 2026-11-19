import { expect, test } from "vite-plus/test";
import { floatBits } from "../../ios/abi/scalars";
import { Fog, FogMode, fogShader, installFog } from "./fog";
import { GL, GraphicsBridge, RenderingAPI, type GraphicsCall } from "./host";

function fixture() {
  const memory = new Uint8Array(64),
    errors: number[] = [],
    fog = new Fog();
  const api: Record<string, GraphicsCall | undefined> = {};
  const bridge = new GraphicsBridge({
    api,
    gl: () => {
      throw new Error("Fog state must not need a graphics context.");
    },
    currentAPI: () => RenderingAPI.OpenGLES1,
    currentContext: () => 1,
    boundArray: () => 0,
    read: (pointer, length) => memory.slice(pointer, pointer + length),
    write: (pointer, bytes) => memory.set(bytes, pointer),
    string: () => 0,
    error: (code) => errors.push(code),
  });
  installFog(bridge, () => fog);
  const call = (name: string, ...args: number[]) => api[`_gl${name}`]?.((i) => args[i] ?? 0);
  return { call, errors, fog, memory };
}

test("glFogx takes the mode as an enum and distances as 16.16 fixed point", () => {
  const x = fixture();
  x.call("Fogx", 0x0b65, FogMode.Linear);
  x.call("Fogx", 0x0b64, 10 * 65536);
  x.call("Fogf", 0x0b63, floatBits(2.5));
  expect([x.fog.mode, x.fog.start, x.fog.end]).toEqual([FogMode.Linear, 2.5, 10]);
});

test("glFogfv reads and clamps a colour; bad values raise GL errors", () => {
  const x = fixture(),
    view = new DataView(x.memory.buffer);
  [0.25, 2, -1, 1].forEach((value, index) => view.setFloat32(index * 4, value, true));
  x.call("Fogfv", 0x0b66, 0);
  x.call("Fogf", 0x0b62, floatBits(-1));
  x.call("Fogx", 0x0b65, 0x1234);
  expect(x.fog.color).toEqual([0.25, 1, 0, 1]);
  expect(x.errors).toEqual([GL.InvalidValue, GL.InvalidEnum]);
});

test("disabled fog adds no shader code", () => {
  expect(fogShader(0).fragment).toBe("");
  expect(fogShader(FogMode.Linear).fragment).toContain("uFog.z - vFogDepth");
});
