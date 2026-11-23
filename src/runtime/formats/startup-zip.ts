import { openIPA, type ZipEntry } from "../ios/package/ipa";

const LOCAL_SIGNATURE = 0x0403_4b50;
const CENTRAL_SIGNATURE = 0x0201_4b50;
const END_SIGNATURE = 0x0605_4b50;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;
const END_RECORD_BYTES = 22;
const VERSION_UNIX_ZIP_2 = 0x0314;
const VERSION_NEEDED = 20;
const UTF8_FLAG = 0x0800;
const DOS_DATE_1980 = 0x21;
const MODE_EXECUTABLE = 0o100_755;
const MODE_FILE = 0o100_644;
const MODE_SHIFT = 65_536;
const CENTRAL_SHIFT = 2;
const MAX_ENTRY_BYTES = 0x2000_0000;
const MAX_NAME_LENGTH = 80;
const Field = {
  Version: 4,
  Flags: 6,
  Method: 8,
  Date: 12,
  Crc: 14,
  CompressedSize: 18,
  Size: 22,
  NameLength: 26,
} as const;
const CentralField = { Attributes: 38, Offset: 42 } as const;
const EndField = {
  DiskEntries: 8,
  TotalEntries: 10,
  DirectorySize: 12,
  DirectoryOffset: 16,
} as const;

interface Headers {
  readonly local: DataView<ArrayBuffer>;
  readonly central: DataView<ArrayBuffer>;
}

// Keep the original compressed payloads. Both headers use their known sizes
// and CRC, so an input with trailing data descriptors needs none in the export.
function headers(entry: ZipEntry, offset: number, executable: boolean): Headers {
  const name = new TextEncoder().encode(entry.path);
  const local = new DataView(new ArrayBuffer(LOCAL_HEADER_BYTES + name.length));
  const central = new DataView(new ArrayBuffer(CENTRAL_HEADER_BYTES + name.length));
  local.setUint32(0, LOCAL_SIGNATURE, true);
  central.setUint32(0, CENTRAL_SIGNATURE, true);
  central.setUint16(Field.Version, VERSION_UNIX_ZIP_2, true);
  for (const [header, shift] of [
    [local, 0],
    [central, CENTRAL_SHIFT],
  ] as const) {
    header.setUint16(Field.Version + shift, VERSION_NEEDED, true);
    header.setUint16(Field.Flags + shift, UTF8_FLAG, true);
    header.setUint16(Field.Method + shift, entry.method, true);
    header.setUint16(Field.Date + shift, DOS_DATE_1980, true);
    header.setUint32(Field.Crc + shift, entry.crc, true);
    header.setUint32(Field.CompressedSize + shift, entry.compressedSize, true);
    header.setUint32(Field.Size + shift, entry.size, true);
    header.setUint16(Field.NameLength + shift, name.length, true);
    new Uint8Array(header.buffer, header.byteLength - name.length).set(name);
  }
  central.setUint32(
    CentralField.Attributes,
    (executable ? MODE_EXECUTABLE : MODE_FILE) * MODE_SHIFT,
    true,
  );
  central.setUint32(CentralField.Offset, offset, true);
  return { local, central };
}

export async function createStartupZip(file: Blob): Promise<{ blob: Blob; filename: string }> {
  const app = await openIPA(file);
  const infoPath = `${app.bundlePath}/Info.plist`;
  if (app.executablePath === infoPath) throw new Error("Invalid executable path in Info.plist.");
  const local: BlobPart[] = [],
    directory: DataView<ArrayBuffer>[] = [];
  let offset = 0;
  for (const path of [infoPath, app.executablePath]) {
    const entry = app.entries.get(path);
    if (!entry) throw new Error(`Startup entry is missing: ${path}`);
    if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES)
      throw new Error(`Startup entry exceeds the 512 MiB runtime limit: ${path}`);
    const bytes = await app.compressedBlob(path);
    const record = headers(entry, offset, path === app.executablePath);
    local.push(record.local, bytes);
    directory.push(record.central);
    offset += record.local.byteLength + bytes.size;
  }
  const end = new DataView(new ArrayBuffer(END_RECORD_BYTES));
  end.setUint32(0, END_SIGNATURE, true);
  end.setUint16(EndField.DiskEntries, directory.length, true);
  end.setUint16(EndField.TotalEntries, directory.length, true);
  end.setUint32(
    EndField.DirectorySize,
    directory.reduce((size, record) => size + record.byteLength, 0),
    true,
  );
  end.setUint32(EndField.DirectoryOffset, offset, true);
  const executable = app.info.CFBundleExecutable;
  if (typeof executable !== "string") throw new Error("Invalid executable name in Info.plist.");
  const name = executable.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, MAX_NAME_LENGTH) || "app";
  return {
    blob: new Blob([...local, ...directory, end], { type: "application/zip" }),
    filename: `${name}-startup.zip`,
  };
}
