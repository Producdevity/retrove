import { TciLimit, type Comparison, type Operand, type Pair, type TciAbi } from "./model";
export class TciCursor {
  offset = 0;
  limit: number;
  private readonly view: DataView;
  constructor(
    readonly bytes: Uint8Array,
    readonly address: number,
    readonly abi: TciAbi,
  ) {
    this.limit = bytes.length;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  byte(): number {
    if (this.offset >= this.limit) throw new RangeError("Truncated TCI instruction.");
    const value = this.bytes[this.offset++];
    if (value === undefined) throw new RangeError("Truncated TCI instruction.");
    return value;
  }
  word(): number {
    if (this.offset + TciLimit.WordBytes > this.limit)
      throw new RangeError("Truncated TCI operand.");
    const value = this.view.getUint32(this.offset, true);
    this.offset += TciLimit.WordBytes;
    return value;
  }
  register(): number {
    const value = this.byte();
    if (value >= TciLimit.Registers) throw new RangeError("Invalid TCI register.");
    return value;
  }
  destination(): number {
    const value = this.register();
    if (value === TciLimit.Environment || value === TciLimit.Stack)
      throw new Error("TCI writes a reserved register.");
    return value;
  }
  source(): Operand {
    return { kind: "register", index: this.register() };
  }
  operand(): Operand {
    if (this.bytes[this.offset] !== TciLimit.ConstantOperand) return this.source();
    this.byte();
    return { kind: "constant", value: this.word() };
  }
  pair(immediate = false): Pair {
    return immediate ? [this.operand(), this.operand()] : [this.source(), this.source()];
  }
  comparison(): Comparison {
    const value = this.abi.comparisons.get(this.byte());
    if (!value) throw new Error("Unknown TCI comparison.");
    return value;
  }
}
