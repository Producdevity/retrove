import {openIPA} from './ipa.mjs';

// Keep the original compressed payloads. Both headers use their known sizes
// and CRC, so an input with trailing data descriptors needs none in the export.
function headers(entry, offset, executable) {
  const name = new TextEncoder().encode(entry.path);
  const local = new DataView(new ArrayBuffer(30 + name.length));
  const central = new DataView(new ArrayBuffer(46 + name.length));
  local.setUint32(0, 0x04034b50, true);
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 0x0314, true); // Unix, ZIP 2.0
  for (const [header, shift] of [[local, 0], [central, 2]]) {
    header.setUint16(4 + shift, 20, true);
    header.setUint16(6 + shift, 0x0800, true); // UTF-8 filename
    header.setUint16(8 + shift, entry.method, true);
    header.setUint16(12 + shift, 0x21, true); // 1980-01-01
    header.setUint32(14 + shift, entry.crc, true);
    header.setUint32(18 + shift, entry.compressedSize, true);
    header.setUint32(22 + shift, entry.size, true);
    header.setUint16(26 + shift, name.length, true);
    new Uint8Array(header.buffer, header.byteLength - name.length).set(name);
  }
  central.setUint32(38, (executable ? 0o100755 : 0o100644) * 65536, true);
  central.setUint32(42, offset, true);
  return {local, central};
}

export async function createStartupZip(file) {
  const app = await openIPA(file);
  const infoPath = app.bundlePath + '/Info.plist';
  if (app.executablePath === infoPath) throw Error('Invalid executable path in Info.plist.');
  const local = [], directory = [];
  let offset = 0;
  for (const path of [infoPath, app.executablePath]) {
    const entry = app.entries.get(path);
    if (entry.size > 512 * 1024 * 1024 || entry.compressedSize > 512 * 1024 * 1024)
      throw Error('Startup entry exceeds the 512 MiB runtime limit: ' + path);
    const bytes = await app.compressedBlob(path);
    const record = headers(entry, offset, path === app.executablePath);
    local.push(record.local, bytes);
    directory.push(record.central);
    offset += record.local.byteLength + bytes.size;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, directory.length, true);
  end.setUint16(10, directory.length, true);
  end.setUint32(12, directory.reduce((size, record) => size + record.byteLength, 0), true);
  end.setUint32(16, offset, true);
  const name = app.info.CFBundleExecutable.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'app';
  return {blob: new Blob([...local, ...directory, end], {type: 'application/zip'}), filename: name + '-startup.zip'};
}
