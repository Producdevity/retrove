import type { HostResult } from "./host";
const ClassField = { Parent: 4, ReadOnly: 16 } as const;
const ReadOnlyField = { InstanceBytes: 8, Ivars: 28 } as const;
const ListField = { Stride: 0, Count: 4, Items: 8 } as const;
const IvarField = { Offset: 0, Name: 4, Type: 8 } as const;
const MIN_IVAR_BYTES = 20;
const WORD_BYTES = 4;
const MAX_IVARS = 65536;
interface OutletHost {
  read(pointer: number): number;
  write(pointer: number, value: number): void;
  cString(pointer: number): string;
  responds(self: number, selector: string): boolean;
  send(self: number, selector: string, args: number[]): Promise<HostResult>;
  retain(pointer: number): number;
  release(pointer: number): Promise<void>;
}
export async function connectOutlet(
  host: OutletHost,
  self: number,
  key: string,
  value: number,
): Promise<void> {
  if (!key) throw new Error("Nib outlet has no key.");
  const setter = `set${key.charAt(0).toUpperCase()}${key.slice(1)}:`;
  if (host.responds(self, setter)) {
    await host.send(self, setter, [value]);
    return;
  }
  for (let cls = host.read(self); cls; cls = host.read(cls + ClassField.Parent)) {
    const info = host.read(cls + ClassField.ReadOnly),
      list = host.read(info + ReadOnlyField.Ivars);
    if (!list) continue;
    const stride = host.read(list + ListField.Stride),
      count = host.read(list + ListField.Count);
    if (stride < MIN_IVAR_BYTES || count > MAX_IVARS)
      throw new Error("Invalid Objective-C ivar list.");
    for (let index = 0; index < count; index++) {
      const ivar = list + ListField.Items + index * stride,
        name = host.cString(host.read(ivar + IvarField.Name));
      if (name !== key && name !== `_${key}`) continue;
      const offset = host.read(host.read(ivar + IvarField.Offset));
      if (
        !host.cString(host.read(ivar + IvarField.Type)).startsWith("@") ||
        offset < WORD_BYTES ||
        offset + WORD_BYTES > host.read(info + ReadOnlyField.InstanceBytes)
      )
        throw new Error("Invalid nib object outlet.");
      const previous = host.read(self + offset);
      host.write(self + offset, host.retain(value));
      await host.release(previous);
      return;
    }
  }
  throw new Error("Nib outlet does not exist: " + key);
}
