export const base64: string;
/** [offset, length, permissions] */
export const segments: readonly (readonly [number, number, number])[];
export const relocations: readonly number[];
export const entries: Readonly<Record<string, number>>;
