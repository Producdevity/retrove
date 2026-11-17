export interface TextureDecoder {
  decode_pvrtc(data: Uint8Array, width: number, height: number, twoBit: boolean): Uint8Array | null;
}
export default function createModule(): Promise<TextureDecoder>;
