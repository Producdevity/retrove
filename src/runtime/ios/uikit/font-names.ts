const Sfnt = {
  Header: 12,
  Count: 4,
  Record: 16,
  Offset: 8,
  Length: 12,
  NameTag: 0x6e616d65,
} as const;
const Name = { Header: 6, Count: 2, Storage: 4, Record: 12, Id: 6, Length: 8, Offset: 10 } as const;
const FontName = { Family: 1, Full: 4, PostScript: 6 } as const;
const Platform = { Unicode: 0, Macintosh: 1, Windows: 3 } as const;
const ENCODING_OFFSET = 2;
const WindowsEncoding = { Symbol: 0, Bmp: 1, Full: 10 } as const;
const WINDOWS_UNICODE = new Set<number>(Object.values(WindowsEncoding));
const utf16 = new TextDecoder("utf-16be", { fatal: true });
const macintosh = new TextDecoder("macintosh", { fatal: true });
function region(bytes: Uint8Array, offset: number, length: number): Uint8Array {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength)
    throw new Error("Invalid font table bounds.");
  return bytes.subarray(offset, offset + length);
}
function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function nameTable(bytes: Uint8Array): Uint8Array | undefined {
  const header = view(region(bytes, 0, Sfnt.Header));
  const count = header.getUint16(Sfnt.Count);
  for (let index = 0; index < count; index++) {
    const record = view(region(bytes, Sfnt.Header + index * Sfnt.Record, Sfnt.Record));
    if (record.getUint32(0) === Sfnt.NameTag)
      return region(bytes, record.getUint32(Sfnt.Offset), record.getUint32(Sfnt.Length));
  }
  return undefined;
}
export function fontNames(bytes: Uint8Array): string[] {
  const table = nameTable(bytes);
  if (!table) return [];
  const header = view(region(table, 0, Name.Header));
  const count = header.getUint16(Name.Count),
    start = header.getUint16(Name.Storage);
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    const record = view(region(table, Name.Header + index * Name.Record, Name.Record));
    const id = record.getUint16(Name.Id),
      platform = record.getUint16(0),
      encoding = record.getUint16(ENCODING_OFFSET);
    if (id !== FontName.Full && id !== FontName.PostScript && id !== FontName.Family) continue;
    const decoder =
      platform === Platform.Unicode ||
      (platform === Platform.Windows && WINDOWS_UNICODE.has(encoding))
        ? utf16
        : platform === Platform.Macintosh && encoding === 0
          ? macintosh
          : undefined;
    if (!decoder) continue;
    const name = decoder
      .decode(region(table, start + record.getUint16(Name.Offset), record.getUint16(Name.Length)))
      .trim();
    if (name) names.add(name);
  }
  return [...names];
}
