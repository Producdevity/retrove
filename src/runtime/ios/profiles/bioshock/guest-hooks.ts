import type { GuestCPU } from "../../../../../web/cpu.mjs";
import artifact from "./guest-hooks.json";

const WORD_BYTES = 4;
const PAGE_BYTES = 4096;
const NAME_BYTES = 8;
const READ_EXECUTE = 5;
const ARM_ABSOLUTE_JUMP = 0xe51ff004;
/** push {r4-r7,lr}; add r7,sp,#12, which the hooks replay on a miss. */
const Prologue = { Push: 0xe92d40f0, FramePointer: 0xe28d700c } as const;
const Light = {
  Address: 0xb0cff8,
  DataLoadAt: 11,
  DataLoad: 0xe59543c4,
  RevisionLoadAt: 55,
  RevisionLoad: 0xe59503cc,
  LightRevisionAt: 56,
  LightRevision: 0xe5941004,
} as const;
const Refresh = {
  Address: 0x5e0bdc,
  DataLoadAt: 11,
  DataLoad: 0xe59543c0,
  RevisionLoadAt: 55,
  RevisionLoad: 0xe59503cc,
  DataRevisionAt: 56,
  DataRevision: 0xe5941074,
  SecondRevisionLoadAt: 59,
  SecondRevisionLoad: 0xe59503d0,
  DataSecondRevisionAt: 60,
  DataSecondRevision: 0xe5941078,
} as const;
const PhotoName = {
  Address: 0x183b0a4,
  TextLow: 0xe3051a0c,
  Slot: 0xe28d00f8,
  TextHighAt: 2,
  TextHigh: 0xe34011a7,
  ConstructAt: 3,
  Construct: 0xebb5428a,
} as const;

interface Hook {
  readonly address: number;
  readonly routine: number;
  /** [word index, instruction] pairs from the verified 1.3.5 executable. */
  readonly expected: readonly (readonly [number, number])[];
}
const PROLOGUE = [
  [0, Prologue.Push],
  [1, Prologue.FramePointer],
] as const;
const HOOKS: readonly Hook[] = [
  {
    address: Light.Address,
    routine: artifact.symbols.retrove_light_render_data,
    expected: [
      ...PROLOGUE,
      [Light.DataLoadAt, Light.DataLoad],
      [Light.RevisionLoadAt, Light.RevisionLoad],
      [Light.LightRevisionAt, Light.LightRevision],
    ],
  },
  {
    address: Refresh.Address,
    routine: artifact.symbols.retrove_refresh_render_data,
    expected: [
      ...PROLOGUE,
      [Refresh.DataLoadAt, Refresh.DataLoad],
      [Refresh.RevisionLoadAt, Refresh.RevisionLoad],
      [Refresh.DataRevisionAt, Refresh.DataRevision],
      [Refresh.SecondRevisionLoadAt, Refresh.SecondRevisionLoad],
      [Refresh.DataSecondRevisionAt, Refresh.DataSecondRevision],
    ],
  },
  {
    address: PhotoName.Address,
    routine: artifact.symbols.retrove_photo_target_name,
    expected: [
      [0, PhotoName.TextLow],
      [1, PhotoName.Slot],
      [PhotoName.TextHighAt, PhotoName.TextHigh],
      [PhotoName.ConstructAt, PhotoName.Construct],
    ],
  },
];

interface HookHost {
  readonly cpu: GuestCPU;
  readonly heap: { alloc(size: number, alignment: number): number };
}
function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * WORD_BYTES),
    view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * WORD_BYTES, value >>> 0, true));
  return bytes;
}
function word(cpu: GuestCPU, address: number): number {
  const bytes = cpu.read(address, WORD_BYTES);
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
}
function matches(cpu: GuestCPU, hook: Hook): boolean {
  return hook.expected.every(
    ([index, value]) => word(cpu, hook.address + index * WORD_BYTES) === value,
  );
}

/**
 * ARM fast paths for per-frame BioShock routines that rebuild data they already hold: actor render
 * data while its revisions match, and the material's PhotoRenderTarget name. They run as
 * translated code, so every CPU method keeps them. Returns how many were installed.
 */
export function installBioShockHooks({ cpu, heap }: HookHost): number {
  const hooks = HOOKS.filter((hook) => matches(cpu, hook));
  if (!hooks.length) return 0;
  const base = heap.alloc(PAGE_BYTES, PAGE_BYTES),
    name = heap.alloc(NAME_BYTES, NAME_BYTES);
  if (!base || !name) return 0;
  cpu.write(name, new Uint8Array(NAME_BYTES));
  const code = Uint8Array.from(atob(artifact.code), (character) => character.charCodeAt(0));
  new DataView(code.buffer).setUint32(artifact.symbols.retrove_photo_target_cache, name, true);
  cpu.write(base, code);
  cpu.protect(base, PAGE_BYTES, READ_EXECUTE);
  for (const hook of hooks) cpu.write(hook.address, words(ARM_ABSOLUTE_JUMP, base + hook.routine));
  return hooks.length;
}
