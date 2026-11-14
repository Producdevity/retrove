import caseFolding from "./case-fold.json";
export const StringCompareOption = {
  CaseInsensitive: 1,
  Literal: 2,
  Backwards: 4,
  Anchored: 8,
  Numeric: 64,
  DiacriticInsensitive: 128,
} as const;
const folding = new Map(Object.entries(caseFolding));
const NONLITERAL_SEGMENTS = /(?:[^\p{M}]\p{M}*|\p{M}+)/gu;
const LITERAL_SEGMENTS = /[\s\S]/gu;
const MARKS = /\p{M}/gu;
export interface SearchText {
  value: string;
  boundaries: ReadonlyMap<number, number>;
}
export function searchText(value: string, options: number): SearchText {
  const literal = Boolean(options & StringCompareOption.Literal);
  const boundaries = new Map<number, number>([[0, 0]]);
  const pieces: string[] = [];
  let length = 0;
  for (const segment of value.matchAll(literal ? LITERAL_SEGMENTS : NONLITERAL_SEGMENTS)) {
    const original = segment[0],
      start = segment.index;
    let part = literal ? original : original.normalize("NFD");
    if (options & StringCompareOption.CaseInsensitive)
      part = Array.from(part, (character) => folding.get(character) ?? character).join("");
    if (!literal) part = part.normalize("NFD");
    if (options & StringCompareOption.DiacriticInsensitive) part = part.replace(MARKS, "");
    boundaries.set(length, start);
    pieces.push(part);
    length += part.length;
    boundaries.set(length, start + original.length);
  }
  return { value: pieces.join(""), boundaries };
}
