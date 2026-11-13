// PVRTC1 padding applies independently at each mip, down to a 2x2 block footprint.
let decoder;
export async function decodePVRTC(format, width, height, data) {
  const twoBit = format === 0x8c01 || format === 0x8c03;
  const rgb = format === 0x8c00 || format === 0x8c01;
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216 ||
      width & (width - 1) || height & (height - 1)) {
    throw Error('Invalid PVRTC1 dimensions ' + width + 'x' + height);
  }
  const paddedW = Math.max(width, twoBit ? 16 : 8), paddedH = Math.max(height, 8);
  if (data.byteLength !== paddedW*paddedH / (twoBit ? 4 : 2)) throw Error('Incorrect PVRTC1 mip size');
  decoder ??= import('./vendor/texture2ddecoder.mjs').then(m => m.default());
  const bgra = (await decoder).decode_pvrtc(data,paddedW,paddedH,twoBit);
  if (!bgra || bgra.length !== paddedW*paddedH*4) throw Error('Could not decode PVRTC1 texture');
  const output = new Uint8Array(width*height*4);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const src=(y*paddedW+x)*4, dst=(y*width+x)*4;
    output[dst]=bgra[src+2]; output[dst+1]=bgra[src+1];
    output[dst+2]=bgra[src]; output[dst+3]=rgb ? 255 : bgra[src+3];
  }
  return output;
}
