import { Bytes } from "./wasm-bytes";
import { BlockType, Op, SaturatingPrefix, type ValueType } from "./wasm-opcodes";

const FloatBytes = { Single: 4, Double: 8 } as const;

/** Structured code builder. Labels are resolved by name against the open control stack. */
export class Code {
  readonly body = new Bytes();
  private readonly stack: string[] = [];
  private readonly locals: ValueType[] = [];

  constructor(private readonly parameters: number) {}

  local(type: ValueType): number {
    this.locals.push(type);
    return this.parameters + this.locals.length - 1;
  }

  op(...values: number[]): this {
    this.body.byte(...values);
    return this;
  }

  i32(value: number): this {
    this.body.byte(Op.I32Const).signed(value | 0);
    return this;
  }

  i64(value: bigint): this {
    this.body.byte(Op.I64Const).signed64(value);
    return this;
  }

  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(FloatBytes.Single));
    view.setFloat32(0, value, true);
    this.body.byte(Op.F32Const);
    for (let index = 0; index < FloatBytes.Single; index++) this.body.byte(view.getUint8(index));
    return this;
  }

  f64(value: number): this {
    const view = new DataView(new ArrayBuffer(FloatBytes.Double));
    view.setFloat64(0, value, true);
    this.body.byte(Op.F64Const);
    for (let index = 0; index < FloatBytes.Double; index++) this.body.byte(view.getUint8(index));
    return this;
  }

  get(index: number): this {
    this.body.byte(Op.LocalGet).unsigned(index);
    return this;
  }

  set(index: number): this {
    this.body.byte(Op.LocalSet).unsigned(index);
    return this;
  }

  tee(index: number): this {
    this.body.byte(Op.LocalTee).unsigned(index);
    return this;
  }

  memory(opcode: number, offset = 0): this {
    this.body.byte(opcode).unsigned(0).unsigned(offset);
    return this;
  }

  saturating(opcode: number): this {
    this.body.byte(SaturatingPrefix).unsigned(opcode);
    return this;
  }

  call(index: number): this {
    this.body.byte(Op.Call).unsigned(index);
    return this;
  }

  callIndirect(typeIndex: number): this {
    this.body.byte(Op.CallIndirect).unsigned(typeIndex).unsigned(0);
    return this;
  }

  open(kind: number, label: string, result: number = BlockType.Empty): this {
    this.body.byte(kind, result);
    this.stack.push(label);
    return this;
  }

  else(): this {
    this.body.byte(Op.Else);
    return this;
  }

  end(): this {
    this.body.byte(Op.End);
    this.stack.pop();
    return this;
  }

  depth(label: string): number {
    const index = this.stack.lastIndexOf(label);
    if (index < 0) throw new Error("Unknown label " + label);
    return this.stack.length - 1 - index;
  }

  br(label: string): this {
    this.body.byte(Op.Br).unsigned(this.depth(label));
    return this;
  }

  brIf(label: string): this {
    this.body.byte(Op.BrIf).unsigned(this.depth(label));
    return this;
  }

  brTable(labels: readonly string[], fallback: string): this {
    this.body.byte(Op.BrTable).unsigned(labels.length);
    for (const label of labels) this.body.unsigned(this.depth(label));
    this.body.unsigned(this.depth(fallback));
    return this;
  }

  encode(): Bytes {
    const groups: { count: number; type: ValueType }[] = [];
    for (const type of this.locals) {
      const last = groups.at(-1);
      if (last && last.type === type) last.count++;
      else groups.push({ count: 1, type });
    }
    const out = new Bytes().unsigned(groups.length);
    for (const { count, type } of groups) out.unsigned(count).byte(type);
    out.append(this.body.values).byte(Op.End);
    return new Bytes().sized(out);
  }
}
