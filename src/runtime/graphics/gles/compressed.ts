import { decodePVRTC } from "../pvrtc";
import { TEXEL_BYTES } from "../gpu-memory";
import { words8, words9 } from "./arguments";
import { Gles, PVRTC_FORMATS } from "./constants";
import type { GlesContext } from "./context";
import { pvrtcSupported } from "./extensions";
import { sourceBytes } from "./data";

const HEX_RADIX = 16;
const UNPACK_BYTE_ALIGNMENT = 1;

function nativeSupport(host: GlesContext, format: number): boolean {
  const gl = host.gl();
  if (PVRTC_FORMATS.includes(format)) return pvrtcSupported(gl);
  if (format >= Gles.S3tcFirst && format <= Gles.S3tcLast) {
    if (gl.getExtension("WEBGL_compressed_texture_s3tc")) return true;
  } else if (format === Gles.Etc1 && gl.getExtension("WEBGL_compressed_texture_etc1")) return true;
  throw new Error("Unsupported GLES compressed texture format 0x" + format.toString(HEX_RADIX));
}

async function compressedImage(host: GlesContext, a: (n: number) => number): Promise<void> {
  const [target, level, format, width, height, border, size, pointer] = words8(a);
  // A null pointer allocates an uninitialized complete compressed mip.
  const data = pointer ? sourceBytes(host.cpu, pointer, size) : new Uint8Array(size);
  if (nativeSupport(host, format)) {
    host.gl().compressedTexImage2D(target, level, format, width, height, border, data);
    host.textureLevel(target, level, data.byteLength);
    return;
  }
  const rgba = pointer ? await decodePVRTC(format, width, height, data) : null;
  host.gl().pixelStorei(Gles.UnpackAlignment, UNPACK_BYTE_ALIGNMENT);
  try {
    host
      .gl()
      .texImage2D(
        target,
        level,
        Gles.Rgba,
        width,
        height,
        border,
        Gles.Rgba,
        Gles.UnsignedByte,
        rgba,
      );
    host.textureLevel(target, level, width * height * TEXEL_BYTES);
  } finally {
    host.gl().pixelStorei(Gles.UnpackAlignment, host.unpackAlign);
  }
}

async function compressedSub(host: GlesContext, a: (n: number) => number): Promise<void> {
  const [target, level, xOffset, yOffset, width, height, format, size, pointer] = words9(a);
  const data = sourceBytes(host.cpu, pointer, size);
  if (nativeSupport(host, format)) {
    host.gl().compressedTexSubImage2D(target, level, xOffset, yOffset, width, height, format, data);
    return;
  }
  const rgba = await decodePVRTC(format, width, height, data);
  host.gl().pixelStorei(Gles.UnpackAlignment, UNPACK_BYTE_ALIGNMENT);
  try {
    host
      .gl()
      .texSubImage2D(
        target,
        level,
        xOffset,
        yOffset,
        width,
        height,
        Gles.Rgba,
        Gles.UnsignedByte,
        rgba,
      );
  } finally {
    host.gl().pixelStorei(Gles.UnpackAlignment, host.unpackAlign);
  }
}

/** Compressed uploads; PVRTC is decoded on the host where the driver lacks it. */
export function installCompressed(host: GlesContext): void {
  host.bind("CompressedTexImage2D", (a) => compressedImage(host, a));
  host.bind("CompressedTexSubImage2D", (a) => compressedSub(host, a));
}
