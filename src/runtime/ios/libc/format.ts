import type { GuestMemory } from "../../memory/guest-memory";
import { formatFloat, formatInteger, type Piece } from "./format-numbers";
import { narrow, utf8Bytes, wide } from "./format-text";

const WORD_SHIFT = 32n;
const ERROR_CONTEXT = 18;
const BYTE_MASK = 0xff;
const LONG_LENGTHS = ["ll", "q", "j"];
const NULL_TEXT = "(null)";
const Size = { Byte: 1, Half: 2, Word: 4, Long: 8 } as const;
// ARMv7 Darwin varargs pack 64-bit values at four-byte alignment.
const SPEC =
  /%([-+# 0']*)(\*|[0-9]*)(?:\.(\*|[0-9]*))?(hh|ll|[hlqjztL])?([diuoxXpcCsSneEfgGFaA%@])/y;

interface Spec {
  flags: string;
  precision: number | undefined;
  length: string | undefined;
  long: boolean;
  kind: string;
}

function storeSize(length: string | undefined, long: boolean): number {
  if (length === "hh") return Size.Byte;
  if (length === "h") return Size.Half;
  return long ? Size.Long : Size.Word;
}

const plain = (s: string): Piece => ({ s, prefix: "", pad: " " });

class Printf {
  private index = 0;
  private readonly bits = new DataView(new ArrayBuffer(Size.Long));

  constructor(
    private readonly cpu: GuestMemory,
    private readonly word: (index: number) => number,
    private readonly describeObject: ((pointer: number) => string) | undefined,
  ) {}

  run(fmt: string): string {
    const spec = new RegExp(SPEC);
    let out = "",
      pos = 0;
    while (pos < fmt.length) {
      const percent = fmt.indexOf("%", pos);
      if (percent < 0) {
        out += fmt.slice(pos);
        break;
      }
      out += fmt.slice(pos, percent);
      spec.lastIndex = percent;
      const match = spec.exec(fmt);
      if (!match)
        throw new Error(
          "Unsupported Darwin printf conversion " + fmt.slice(percent, percent + ERROR_CONTEXT),
        );
      pos = spec.lastIndex;
      const [, flagText = "", w = "", p, length, kind = ""] = match;
      let flags = flagText;
      let width = w === "*" ? this.next() | 0 : Number(w);
      if (width < 0) {
        flags += "-";
        width = -width;
      }
      const digits = p === "*" ? this.next() | 0 : p === undefined ? -1 : Number(p);
      const precision = digits < 0 ? undefined : digits;
      const piece = this.convert(
        { flags, precision, length, long: LONG_LENGTHS.includes(length ?? ""), kind },
        out.length,
      );
      if (piece) out += place(piece, width, flags.includes("-"));
    }
    return out;
  }

  private next(): number {
    return this.word(this.index++) >>> 0;
  }

  private next64(): bigint {
    return BigInt(this.next()) | (BigInt(this.next()) << WORD_SHIFT);
  }

  private convert(spec: Spec, written: number): Piece | undefined {
    const { kind, flags, precision, length, long } = spec;
    if (kind === "%") return plain("%");
    if (kind === "@" && this.describeObject) {
      const pointer = this.next();
      return plain(utf8Bytes(pointer ? this.describeObject(pointer) : NULL_TEXT));
    }
    if (kind === "n") {
      const at = this.next();
      this.bits.setBigUint64(0, BigInt(written), true);
      this.cpu.write(at, new Uint8Array(this.bits.buffer, 0, storeSize(length, long)));
      return undefined;
    }
    if ("sS".includes(kind)) return plain(this.string(kind, length, precision));
    if ("cC".includes(kind)) {
      const ch = this.next();
      return plain(
        kind === "C" || length === "l"
          ? utf8Bytes(String.fromCodePoint(ch))
          : String.fromCharCode(ch & BYTE_MASK),
      );
    }
    if ("diuoxXp".includes(kind)) {
      const value = long ? this.next64() : BigInt(this.next());
      return formatInteger(value, kind, flags, precision, length, long);
    }
    if (kind === "@") throw new Error("Objective-C format used without an object description");
    return formatFloat(this.next64(), kind, flags, precision);
  }

  private string(kind: string, length: string | undefined, precision: number | undefined) {
    const address = this.next();
    if (!address) return NULL_TEXT.slice(0, precision);
    return kind === "S" || length === "l"
      ? wide(this.cpu, address, precision)
      : narrow(this.cpu, address, precision);
  }
}

function place(piece: Piece, width: number, left: boolean): string {
  const { s, prefix, pad } = piece;
  const spaces = Math.max(0, width - s.length - prefix.length);
  if (left) return prefix + s + " ".repeat(spaces);
  return pad === "0" ? prefix + "0".repeat(spaces) + s : " ".repeat(spaces) + prefix + s;
}

/** Darwin printf over guest varargs; the result holds one byte per character. */
export function formatDarwin(
  cpu: GuestMemory,
  template: number,
  word: (index: number) => number,
  describeObject?: (pointer: number) => string,
): string {
  return new Printf(cpu, word, describeObject).run(narrow(cpu, template));
}
