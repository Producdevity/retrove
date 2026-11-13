import { Bytes } from "../../wasm/encoding";
import { TciLimit, type Operand, type Pair } from "../model";
import { Local, Op } from "./abi";

export class Emitter extends Bytes {
  integer(value: number): this {
    return this.add(Op.Integer).signed(value | 0);
  }
  get(index: number): this {
    return this.add(Op.Get).unsigned(index);
  }
  set(index: number): this {
    return this.add(Op.Set).unsigned(index);
  }
  operand(value: Operand): this {
    return value.kind === "constant"
      ? this.integer(value.value)
      : this.get(Local.FirstRegister + value.index);
  }
  destination(index: number): this {
    return this.set(Local.FirstRegister + index);
  }
  memory(opcode: number, offset = 0): this {
    return this.add(opcode, 0).unsigned(offset);
  }
  pair(value: Pair): this {
    this.operand(value[0]).add(Op.ExtendUnsigned);
    this.operand(value[1]).add(Op.ExtendUnsigned, Op.WideInteger).signed(TciLimit.WordBits);
    return this.add(Op.WideShl, Op.WideOr);
  }
  wideResult(low: number, high?: number): void {
    this.set(Local.WideResult).get(Local.WideResult).add(Op.Wrap).destination(low);
    if (high !== undefined) {
      this.get(Local.WideResult).add(Op.WideInteger).signed(TciLimit.WordBits);
      this.add(Op.WideShr, Op.Wrap).destination(high);
    }
  }
  registers(direction: "load" | "store"): void {
    for (let index = 0; index < TciLimit.Registers; index++) {
      this.get(Local.Registers);
      if (direction === "load") {
        this.memory(Op.Load, index * TciLimit.WordBytes).destination(index);
      } else {
        this.get(Local.FirstRegister + index).memory(Op.Store, index * TciLimit.WordBytes);
      }
    }
  }
  programCounter(pointer: number, address: number): void {
    this.integer(pointer).integer(address).memory(Op.Store);
  }
}
