import { WORD_BYTES } from "../abi/scalars";

const StateField = { Position: 0, Items: 4, Mutations: 8 } as const;
interface EnumerationMemory {
  allocate(bytes: number): number;
  free(pointer: number): void;
  read(pointer: number): number;
  write(pointer: number, value: number): void;
}
export class FastEnumeration {
  private readonly versions = new Map<number, number>();
  constructor(private readonly memory: EnumerationMemory) {}
  read(
    collection: number,
    state: number,
    buffer: number,
    capacity: number,
    values: readonly number[],
  ): number {
    const start = this.memory.read(state + StateField.Position);
    const count = Math.min(capacity, Math.max(0, values.length - start));
    if (!count) return 0;
    let version = this.versions.get(collection);
    if (version === undefined) {
      version = this.memory.allocate(WORD_BYTES);
      this.memory.write(version, 0);
      this.versions.set(collection, version);
    }
    for (let index = 0; index < count; index++) {
      const value = values[start + index];
      if (value === undefined) throw Error("Invalid fast-enumeration element");
      this.memory.write(buffer + index * WORD_BYTES, value);
    }
    this.memory.write(state + StateField.Position, start + count);
    this.memory.write(state + StateField.Items, buffer);
    this.memory.write(state + StateField.Mutations, version);
    return count;
  }
  changed(collection: number): void {
    const version = this.versions.get(collection);
    if (version !== undefined) this.memory.write(version, (this.memory.read(version) + 1) >>> 0);
  }
  destroy(collection: number): void {
    const version = this.versions.get(collection);
    if (version !== undefined) this.memory.free(version);
    this.versions.delete(collection);
  }
}
