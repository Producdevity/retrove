const KIBIBYTE = 1024;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;
const GIBIBYTE = MEBIBYTE * KIBIBYTE;
const LARGE_PRECISION = 2;
export function formatBytes(bytes: number): string {
  if (bytes >= GIBIBYTE) return `${(bytes / GIBIBYTE).toFixed(LARGE_PRECISION)} GB`;
  if (bytes >= MEBIBYTE) return `${(bytes / MEBIBYTE).toFixed(1)} MB`;
  return `${Math.ceil(bytes / KIBIBYTE)} KB`;
}
