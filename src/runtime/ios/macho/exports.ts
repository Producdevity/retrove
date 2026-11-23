import { Cursor } from "./cursor";
import { MAX_ADDRESS, requireFormat, sub } from "./format";

const ExportFlag = { Absolute: 2, Supported: 6 } as const;

export function exportAddress(
  bytes: Uint8Array | undefined,
  base: number,
  name: string,
): number | null {
  if (!bytes?.length || !name) return null;
  let offset = 0,
    consumed = 0;
  for (;;) {
    const node = new Cursor(bytes, offset);
    const terminalSize = node.leb();
    const terminal = sub(bytes, node.offset, terminalSize, "export trie");
    if (consumed === name.length) {
      if (!terminal.length) return null;
      const value = new Cursor(terminal),
        flags = value.leb();
      requireFormat(!(flags & ~ExportFlag.Supported), `unsupported export type for ${name}`);
      const address = (flags & ExportFlag.Absolute ? 0 : base) + value.leb();
      requireFormat(
        value.offset === terminal.length && address <= MAX_ADDRESS,
        `invalid export ${name}`,
      );
      return address;
    }
    node.offset += terminalSize;
    const children = node.byte();
    let match = false;
    for (let i = 0; i < children; i++) {
      const edge = node.string(),
        next = node.leb();
      requireFormat(edge.length > 0 && next > 0 && next < bytes.length, "invalid export trie edge");
      if (name.startsWith(edge, consumed)) {
        offset = next;
        consumed += edge.length;
        match = true;
        break;
      }
    }
    if (!match) return null;
  }
}
