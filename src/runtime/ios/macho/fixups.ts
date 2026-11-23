import { Cursor } from "./cursor";
import { requireFormat } from "./format";
import { isPageZero, type Segment } from "./segment";

export type FixupMode = "rebase" | "normal" | "lazy" | "weak";
export interface Binding {
  address: number;
  name: string;
  library: string | null;
  ordinal: number;
  kind: number;
  weak: boolean;
  addend: number;
  mode: Exclude<FixupMode, "rebase">;
  lazyOffset?: number;
}
export interface FixupImage {
  readonly segments: readonly Pick<Segment, "name" | "address" | "size">[];
  readonly dylibs: readonly string[];
  readonly imports: Binding[];
  readonly rebases: number[];
}

const OPCODE_SHIFT = 4;
const IMMEDIATE_MASK = 0xf;
const POINTER_BYTES = 4;
const MAX_FIXUPS = 2_000_000;
const MIN_POINTER_TYPE = 1;
const MAX_POINTER_TYPE = 3;
const MIN_SPECIAL_ORDINAL = -3;
const WEAK_LOOKUP_ORDINAL = -3;
const SPECIAL_ORDINAL_BASE = 16;
const ALLOWED_BIND_FLAGS = 9;
const WEAK_IMPORT_FLAG = 1;
const RebaseOp = {
  SetType: 1,
  SetSegment: 2,
  AddAddress: 3,
  AddScaled: 4,
  TimesImmediate: 5,
  TimesUleb: 6,
  AddAfter: 7,
  TimesSkipping: 8,
} as const;
const BindOp = {
  OrdinalImmediate: 1,
  OrdinalUleb: 2,
  OrdinalSpecial: 3,
  SymbolFlags: 4,
  SetType: 5,
  SetAddend: 6,
  SetSegment: 7,
  AddAddress: 8,
  Bind: 9,
  BindAdd: 10,
  BindScaled: 11,
  BindTimesSkipping: 12,
} as const;

class FixupStream {
  private readonly cursor: Cursor;
  private segment: FixupImage["segments"][number] | null | undefined = null;
  private offset = 0;
  private name = "";
  private ordinal = 0;
  private kind = 1;
  private flags = 0;
  private addend = 0;
  private lazyOffset = 0;
  constructor(
    private readonly bytes: Uint8Array,
    private readonly image: FixupImage,
    private readonly mode: FixupMode,
  ) {
    this.cursor = new Cursor(bytes);
  }
  private reset(): void {
    this.segment = null;
    this.offset = 0;
    this.name = "";
    this.ordinal = 0;
    this.kind = 1;
    this.flags = 0;
    this.addend = 0;
  }
  private advance(amount: number): void {
    this.offset = (this.offset + amount) >>> 0;
  }
  private select(index: number): void {
    this.segment = this.image.segments[index];
    this.offset = this.cursor.leb();
    requireFormat(
      this.segment && !isPageZero(this.segment) && this.offset <= this.segment.size,
      "invalid fixup segment",
    );
  }
  private repeat(count: number, stride: number): void {
    if (!count) return;
    const { image, mode, segment } = this;
    const out = mode === "rebase" ? image.rebases : image.imports;
    requireFormat(
      segment &&
        this.offset % POINTER_BYTES === 0 &&
        (stride % POINTER_BYTES === 0 || count === 1) &&
        this.offset + POINTER_BYTES + (count - 1) * stride <= segment.size &&
        out.length + count <= MAX_FIXUPS,
      "fixup outside segment or limit",
    );
    requireFormat(
      mode === "rebase" ||
        (this.name && this.ordinal <= image.dylibs.length && this.ordinal >= MIN_SPECIAL_ORDINAL),
      "invalid bind symbol or ordinal",
    );
    for (let i = 0; i < count; i++) {
      const address = segment.address + this.offset;
      if (mode === "rebase") image.rebases.push(address);
      else image.imports.push(this.binding(address, mode));
      this.advance(stride);
    }
  }
  private binding(address: number, mode: Exclude<FixupMode, "rebase">): Binding {
    return {
      address,
      name: this.name,
      library: this.image.dylibs[this.ordinal - 1] ?? null,
      ordinal: this.ordinal,
      kind: this.kind,
      weak: Boolean(this.flags & WEAK_IMPORT_FLAG) || this.ordinal === WEAK_LOOKUP_ORDINAL,
      addend: this.addend,
      mode,
      ...(mode === "lazy" ? { lazyOffset: this.lazyOffset } : {}),
    };
  }
  private rebase(op: number, imm: number): void {
    const { cursor } = this;
    switch (op) {
      case RebaseOp.SetType:
        requireFormat(imm >= MIN_POINTER_TYPE && imm <= MAX_POINTER_TYPE, "unknown rebase type");
        break;
      case RebaseOp.SetSegment:
        this.select(imm);
        break;
      case RebaseOp.AddAddress:
        this.advance(cursor.leb(false, true));
        break;
      case RebaseOp.AddScaled:
        this.advance(imm * POINTER_BYTES);
        break;
      case RebaseOp.TimesImmediate:
        this.repeat(imm, POINTER_BYTES);
        break;
      case RebaseOp.TimesUleb:
        this.repeat(cursor.leb(), POINTER_BYTES);
        break;
      case RebaseOp.AddAfter:
        this.repeat(1, POINTER_BYTES + cursor.leb(false, true));
        break;
      case RebaseOp.TimesSkipping:
        this.repeat(cursor.leb(), POINTER_BYTES + cursor.leb(false, true));
        break;
      default:
        throw new Error(`Mach-O: unsupported rebase opcode ${op}`);
    }
  }
  private bind(op: number, imm: number): void {
    const { cursor } = this;
    switch (op) {
      case BindOp.OrdinalImmediate:
        this.ordinal = imm;
        break;
      case BindOp.OrdinalUleb:
        this.ordinal = cursor.leb();
        break;
      case BindOp.OrdinalSpecial:
        this.ordinal = imm ? imm - SPECIAL_ORDINAL_BASE : 0;
        break;
      case BindOp.SymbolFlags:
        requireFormat(!(imm & ~ALLOWED_BIND_FLAGS), "invalid bind flags");
        this.flags = imm;
        this.name = cursor.string();
        requireFormat(this.name.length, "empty import name");
        break;
      case BindOp.SetType:
        requireFormat(imm >= MIN_POINTER_TYPE && imm <= MAX_POINTER_TYPE, "unknown bind type");
        this.kind = imm;
        break;
      case BindOp.SetAddend:
        this.addend = cursor.leb(true);
        break;
      case BindOp.SetSegment:
        this.select(imm);
        break;
      case BindOp.AddAddress:
        this.advance(cursor.leb(false, true));
        break;
      case BindOp.Bind:
        this.repeat(1, POINTER_BYTES);
        break;
      case BindOp.BindAdd:
        this.repeat(1, POINTER_BYTES + cursor.leb(false, true));
        break;
      case BindOp.BindScaled:
        this.repeat(1, (imm + 1) * POINTER_BYTES);
        break;
      case BindOp.BindTimesSkipping:
        this.repeat(cursor.leb(), POINTER_BYTES + cursor.leb(false, true));
        break;
      default:
        throw new Error(`Mach-O: unsupported bind opcode ${op}`);
    }
  }
  run(): void {
    const { bytes, cursor } = this;
    while (cursor.offset < bytes.length) {
      const b = cursor.byte(),
        op = b >> OPCODE_SHIFT,
        imm = b & IMMEDIATE_MASK;
      if (!op) {
        requireFormat(!imm, "invalid dyld DONE");
        if (this.mode === "lazy" && cursor.offset < bytes.length) {
          this.lazyOffset = cursor.offset;
          this.reset();
          continue;
        }
        requireFormat(
          bytes.subarray(cursor.offset).every((byte) => byte === 0),
          "trailing dyld opcodes",
        );
        return;
      }
      if (this.mode === "rebase") this.rebase(op, imm);
      else this.bind(op, imm);
    }
  }
}

export function fixupStream(bytes: Uint8Array, image: FixupImage, mode: FixupMode): void {
  if (!bytes.length) return;
  new FixupStream(bytes, image, mode).run();
}
