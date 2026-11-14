import { ColorComponents } from "../color-space";
import { floatBits, WORD_BYTES } from "../../../ios/abi/scalars";
export type RGBA = [number, number, number, number];
export const ColorComponent = { Red: 0, Green: 1, Blue: 2, Alpha: 3 } as const;
export const COLOR_COMPONENTS = 4;
export const ColorName = {
  Black: "kCGColorBlack",
  White: "kCGColorWhite",
  Clear: "kCGColorClear",
} as const;
const HASH_OFFSET = 2166136261;
const HASH_PRIME = 16777619;
interface Color {
  readonly space: number;
  readonly components: readonly number[];
  readonly buffer: number;
  refs: number;
}
export interface ColorMemory {
  allocate(size: number): number;
  free(pointer: number): void;
  read(pointer: number, size: number): Uint8Array;
  write(pointer: number, bytes: Uint8Array): void;
  spaceComponents(pointer: number): number | undefined;
  createSpace(components: number): number;
  retainSpace(pointer: number): number;
  releaseSpace(pointer: number): Promise<void>;
}
export class Colors {
  readonly values = new Map<number, Color>();
  private readonly constants = new Map<string, Promise<number>>();
  constructor(readonly memory: ColorMemory) {}
  get(pointer: number): Color | undefined {
    return this.values.get(pointer);
  }
  has(pointer: number): boolean {
    return this.values.has(pointer);
  }
  create(space: number, components: readonly number[]): number {
    const count = this.memory.spaceComponents(space);
    if (
      (count !== ColorComponents.Monochrome && count !== ColorComponents.RGB) ||
      components.length !== count + 1
    )
      return 0;
    const pointer = this.memory.allocate(WORD_BYTES);
    if (!pointer) return 0;
    const bytes = new Uint8Array(components.length * WORD_BYTES),
      view = new DataView(bytes.buffer);
    components.forEach((value, index) => view.setFloat32(index * WORD_BYTES, value, true));
    const buffer = this.memory.allocate(bytes.length);
    if (!buffer) {
      this.memory.free(pointer);
      return 0;
    }
    this.memory.write(buffer, bytes);
    this.memory.retainSpace(space);
    const stored = components.map((_, index) => view.getFloat32(index * WORD_BYTES, true));
    this.values.set(pointer, { space, components: stored, buffer, refs: 1 });
    return pointer;
  }
  fromMemory(space: number, pointer: number): number {
    if (!pointer) return 0;
    const count = this.memory.spaceComponents(space);
    if (count !== ColorComponents.Monochrome && count !== ColorComponents.RGB) return 0;
    const bytes = this.memory.read(pointer, (count + 1) * WORD_BYTES),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return this.create(
      space,
      Array.from({ length: count + 1 }, (_, index) => view.getFloat32(index * WORD_BYTES, true)),
    );
  }
  async generic(components: readonly number[]): Promise<number> {
    const space = this.memory.createSpace(components.length - 1);
    if (!space) return 0;
    try {
      return this.create(space, components);
    } finally {
      await this.memory.releaseSpace(space);
    }
  }
  retain(pointer: number): number {
    const value = this.get(pointer);
    if (value) value.refs++;
    return value ? pointer : 0;
  }
  async release(pointer: number): Promise<void> {
    const value = this.get(pointer);
    if (!value || --value.refs > 0) return;
    this.values.delete(pointer);
    this.memory.free(value.buffer);
    this.memory.free(pointer);
    await this.memory.releaseSpace(value.space);
  }
  copyWithAlpha(pointer: number, alpha: number): number {
    const value = this.get(pointer);
    if (!value) return 0;
    const components = [...value.components];
    components[components.length - 1] = alpha;
    return this.create(value.space, components);
  }
  alpha(pointer: number): number {
    return this.get(pointer)?.components.at(-1) ?? 0;
  }
  rgba(pointer: number): RGBA | undefined {
    const value = this.get(pointer);
    if (!value) return undefined;
    const red = value.components[0] ?? 0,
      alpha = this.alpha(pointer);
    return value.components.length === ColorComponents.Monochrome + 1
      ? [red, red, red, alpha]
      : [
          red,
          value.components[ColorComponent.Green] ?? 0,
          value.components[ColorComponent.Blue] ?? 0,
          alpha,
        ];
  }
  equal(left: number, right: number): boolean {
    if (left === right) return true;
    const a = this.get(left),
      b = this.get(right);
    if (!a || !b) return false;
    return (
      this.memory.spaceComponents(a.space) === this.memory.spaceComponents(b.space) &&
      a.components.length === b.components.length &&
      a.components.every((value, index) => value === b.components[index])
    );
  }
  hash(pointer: number): number {
    const value = this.get(pointer);
    if (!value) return 0;
    let hash = HASH_OFFSET ^ value.components.length;
    for (const component of value.components)
      hash = Math.imul(hash ^ floatBits(component === 0 ? 0 : component), HASH_PRIME);
    return hash >>> 0;
  }
  async constant(name: string): Promise<number> {
    const existing = this.constants.get(name);
    if (existing) return existing;
    const components =
      name === ColorName.Black
        ? [0, 1]
        : name === ColorName.White
          ? [1, 1]
          : name === ColorName.Clear
            ? [0, 0]
            : undefined;
    if (!components) return 0;
    const pending = this.generic(components);
    this.constants.set(name, pending);
    try {
      const pointer = await pending;
      if (!pointer) this.constants.delete(name);
      return pointer;
    } catch (error) {
      this.constants.delete(name);
      throw error;
    }
  }
}
