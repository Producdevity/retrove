import { gauges as shared, type Gauge, type Gauges } from "../diagnostics/gauges";

const TEXTURE_BINDING_2D = 0x8069;
const TEXTURE_BINDING_CUBE_MAP = 0x8514;
const CUBE_MAP_FIRST_FACE = 0x8515;
const CUBE_MAP_LAST_FACE = 0x851a;
const LEVELS_PER_TARGET = 64;
/** Drivers keep uncompressed colour textures and renderbuffers at four bytes per pixel. */
export const TEXEL_BYTES = 4;

/** The binding query for the texture bound to `target`. */
export function textureBinding(target: number): number {
  return target >= CUBE_MAP_FIRST_FACE && target <= CUBE_MAP_LAST_FACE
    ? TEXTURE_BINDING_CUBE_MAP
    : TEXTURE_BINDING_2D;
}
/** One storage slot of a texture: a mip level of one face. */
export function texturePart(target: number, level: number): number {
  return target * LEVELS_PER_TARGET + level;
}

/**
 * Bytes Retrove asked the GPU to hold per GL object. WebGL reports no memory use, so this is
 * the allocation sizes the app requested, not what the driver actually reserved.
 */
export class GpuMemory {
  readonly #objects = new Map<number, Map<number, number>>();
  constructor(
    private readonly gauge: Gauge,
    private readonly gauges: Gauges = shared,
  ) {}
  set(handle: number, part: number, bytes: number): void {
    if (!handle) return;
    const parts = this.#objects.get(handle) ?? new Map<number, number>();
    this.gauges.add(this.gauge, bytes - (parts.get(part) ?? 0));
    parts.set(part, bytes);
    this.#objects.set(handle, parts);
  }
  drop(handle: number): void {
    const parts = this.#objects.get(handle);
    if (!parts) return;
    let total = 0;
    for (const bytes of parts.values()) total += bytes;
    this.gauges.add(this.gauge, -total);
    this.#objects.delete(handle);
  }
}
