import artifact from "./guest-bindings.json";

const PAGE_BYTES = 4096;
const READ_EXECUTE = 5;
const WORD_BYTES = 4;
/** Never a buffer or texture name the guest can hold, so a shadow word with it always misses. */
const UNKNOWN = 0xffffffff;
const ARRAY_BUFFER = 0x8892;
const ELEMENT_ARRAY_BUFFER = 0x8893;
const TEXTURE_2D = 0x0de1;
const TEXTURE0 = 0x84c0;
const TEXTURE_UNITS = 16;
/** Word offsets in the shadow, matching guest-bindings.S. */
const Slot = { ArrayBuffer: 0, ElementArrayBuffer: 1, ActiveTexture: 2, Textures: 3 } as const;
export const BINDING_SHADOW_BYTES = (Slot.Textures + TEXTURE_UNITS) * WORD_BYTES;

interface GuestMemory {
  write(address: number, bytes: Uint8Array): void;
  protect(address: number, size: number, permissions: number): void;
}
interface GuestHeap {
  alloc(size: number, alignment: number): number;
}
type Write32 = (address: number, value: number) => void;

/**
 * The bindings the host last applied, kept in guest memory so the guest's binding calls can
 * skip the host when nothing would change. Clearing a word only costs the next call an exit.
 */
export class BindingShadow {
  #unit = 0;
  constructor(
    private readonly address: number,
    private readonly write: Write32,
  ) {
    this.forget();
  }
  buffer(target: number, buffer: number): void {
    if (target === ARRAY_BUFFER) this.#set(Slot.ArrayBuffer, buffer);
    else if (target === ELEMENT_ARRAY_BUFFER) this.#set(Slot.ElementArrayBuffer, buffer);
  }
  activeTexture(texture: number): void {
    const unit = texture - TEXTURE0;
    this.#unit = unit >= 0 && unit < TEXTURE_UNITS ? unit : -1;
    this.#set(Slot.ActiveTexture, this.#unit < 0 ? UNKNOWN : texture);
  }
  texture(target: number, texture: number): void {
    if (target === TEXTURE_2D && this.#unit >= 0) this.#set(Slot.Textures + this.#unit, texture);
  }
  /** After deletes or state the shadow does not follow: every next binding call asks the host. */
  forget(): void {
    for (let slot = 0; slot < BINDING_SHADOW_BYTES / WORD_BYTES; slot++) this.#set(slot, UNKNOWN);
  }
  #set(slot: number, value: number): void {
    this.write(this.address + slot * WORD_BYTES, value >>> 0);
  }
}

export interface BindingGates {
  readonly bindBuffer: number;
  readonly activeTexture: number;
  readonly bindTexture: number;
}

/** Installs the binding routines; returns their addresses by import name, empty without a page. */
export function guestBindings(
  memory: GuestMemory,
  heap: GuestHeap,
  shadow: number,
  gates: BindingGates,
): ReadonlyMap<string, number> {
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES);
  if (!base) return new Map();
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  const view = new DataView(code.buffer);
  const { symbols } = artifact;
  view.setUint32(symbols.retrove_bindings_shadow, shadow, true);
  view.setUint32(symbols.retrove_bind_buffer_host, gates.bindBuffer, true);
  view.setUint32(symbols.retrove_active_texture_host, gates.activeTexture, true);
  view.setUint32(symbols.retrove_bind_texture_host, gates.bindTexture, true);
  memory.write(base, code);
  memory.protect(base, PAGE_BYTES, READ_EXECUTE);
  return new Map([
    ["_glBindBuffer", base + symbols.retrove_bind_buffer],
    ["_glActiveTexture", base + symbols.retrove_active_texture],
    ["_glBindTexture", base + symbols.retrove_bind_texture],
  ]);
}
