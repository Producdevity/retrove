import type { GuestArguments } from "../../ios/objc/host";
export type GraphicsCall = (args: GuestArguments) => unknown;
export type Context = WebGLRenderingContext | WebGL2RenderingContext;
export interface FixedHost {
  readonly api: Record<string, GraphicsCall | undefined>;
  gl(): Context;
  currentAPI(): number;
  currentContext(): number;
  boundArray(): number;
  read(pointer: number, bytes: number): Uint8Array;
  write(pointer: number, bytes: Uint8Array): void;
  string(value: string): number;
  error(code: number): void;
}
export const RenderingAPI = { OpenGLES1: 1, OpenGLES2: 2 } as const;
export const GL = {
  InvalidEnum: 0x0500,
  InvalidValue: 0x0501,
  InvalidOperation: 0x0502,
  Texture2D: 0x0de1,
  Texture0: 0x84c0,
  TextureEnvironment: 0x2300,
  EnvironmentMode: 0x2200,
  EnvironmentColor: 0x2201,
  VertexArray: 0x8074,
  NormalArray: 0x8075,
  ColorArray: 0x8076,
  TextureArray: 0x8078,
  PointSizeArray: 0x8b9c,
  PointSprite: 0x8861,
  CoordReplace: 0x8862,
  Points: 0x0000,
  ArrayBuffer: 0x8892,
  Float: 0x1406,
  Fixed: 0x140c,
  Byte: 0x1400,
  Short: 0x1402,
  UnsignedByte: 0x1401,
  AlphaTest: 0x0bc0,
  Lighting: 0x0b50,
  Fog: 0x0b60,
  Normalize: 0x0ba1,
  RescaleNormal: 0x803a,
  ColorMaterial: 0x0b57,
  Smooth: 0x1d01,
  Version: 0x1f02,
  Extensions: 0x1f03,
} as const;
export const Component = { X: 0, Y: 1, Z: 2, W: 3 } as const;
export const FIXED_SCALE = 65536;
export class GraphicsBridge {
  private readonly originals: ReadonlyMap<string, GraphicsCall>;
  constructor(readonly host: FixedHost) {
    this.originals = new Map(
      Object.entries(host.api).flatMap(([name, fn]) => (fn ? [[name, fn]] : [])),
    );
  }
  call(name: string, values: readonly number[]): unknown {
    const fn = this.originals.get(`_gl${name}`);
    if (!fn) throw new Error(`Missing graphics operation ${name}.`);
    return fn((index) => values[index] ?? 0);
  }
  register(name: string, fn: GraphicsCall): void {
    const original = this.originals.get(`_gl${name}`);
    this.host.api[`_gl${name}`] = (args) => {
      if (this.host.currentAPI() === RenderingAPI.OpenGLES1) return fn(args);
      if (original) return original(args);
      this.host.error(GL.InvalidOperation);
      return undefined;
    };
  }
}
