const HEX = 16;
const BYTE_DIGITS = 2;

/** SHA-256 as lowercase hex. */
export async function sha256(
  data: Uint8Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash, (byte) => byte.toString(HEX).padStart(BYTE_DIGITS, "0")).join("");
}
