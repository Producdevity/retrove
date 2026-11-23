const CHUNK = 8192;

export function byteString(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += CHUNK)
    text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return text;
}

export function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}
