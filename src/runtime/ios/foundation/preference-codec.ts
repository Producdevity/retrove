/** A property-list value as NSUserDefaults stores it. */
export type PreferenceValue =
  | string
  | number
  | boolean
  | Uint8Array
  | Date
  | readonly PreferenceValue[]
  | PreferenceDictionary;
export interface PreferenceDictionary {
  readonly [key: string]: PreferenceValue;
}
type Stored = string | number | boolean | readonly Stored[] | { readonly [key: string]: Stored };

/** JSON has no data or date type; these single-key objects carry them in saved preferences. */
const Tag = { Data: "@retrove.data", Date: "@retrove.date" } as const;
const BASE64_CHUNK = 0x8000;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(at, at + BASE64_CHUNK));
  return btoa(binary);
}
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/** Encodes preferences as JSON-safe values. */
export function storedPreference(value: PreferenceValue): Stored {
  if (value instanceof Uint8Array) return { [Tag.Data]: base64(value) };
  if (value instanceof Date) return { [Tag.Date]: value.getTime() };
  if (Array.isArray(value)) {
    const items: readonly PreferenceValue[] = value;
    return items.map(storedPreference);
  }
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, storedPreference(item)]),
    );
  return value;
}

/** Reverses storedPreference for the data and date tags; other values pass through. */
export function restoredPreference(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(restoredPreference);
  }
  if (typeof value !== "object" || value === null) return value;
  const entries: [string, unknown][] = Object.entries(value);
  const [first] = entries;
  if (entries.length === 1 && first) {
    const [key, item] = first;
    if (key === Tag.Data && typeof item === "string") return fromBase64(item);
    if (key === Tag.Date && typeof item === "number") return new Date(item);
  }
  return Object.fromEntries(entries.map(([key, item]) => [key, restoredPreference(item)]));
}
