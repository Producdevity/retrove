export const LineBreak = { Word: 0, Character: 1, Clip: 2, Head: 3, Tail: 4, Middle: 5 } as const;
export type LineBreak = (typeof LineBreak)[keyof typeof LineBreak];
export const TextAlignment = { Left: 0, Center: 1, Right: 2 } as const;
export type MeasureText = (text: string) => number;
const HALF = 2;
const ELLIPSIS = "…";
export function lineBreak(value: number): LineBreak {
  switch (value) {
    case LineBreak.Word:
      return LineBreak.Word;
    case LineBreak.Character:
      return LineBreak.Character;
    case LineBreak.Clip:
      return LineBreak.Clip;
    case LineBreak.Head:
      return LineBreak.Head;
    case LineBreak.Tail:
      return LineBreak.Tail;
    case LineBreak.Middle:
      return LineBreak.Middle;
    default:
      throw new Error("Unsupported line break mode.");
  }
}
function truncate(text: string, width: number, mode: LineBreak, measure: MeasureText): string {
  if (measure(text) <= width || mode === LineBreak.Clip) return text;
  const characters = Array.from(text);
  const candidate = (count: number): string => {
    if (mode === LineBreak.Head)
      return ELLIPSIS + characters.slice(characters.length - count).join("");
    if (mode === LineBreak.Middle)
      return (
        characters.slice(0, Math.ceil(count / HALF)).join("") +
        ELLIPSIS +
        characters.slice(characters.length - Math.floor(count / HALF)).join("")
      );
    return characters.slice(0, count).join("") + ELLIPSIS;
  };
  let low = 0,
    high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / HALF);
    if (measure(candidate(middle)) <= width) low = middle;
    else high = middle - 1;
  }
  return measure(ELLIPSIS) <= width ? candidate(low) : "";
}
function wrap(text: string, width: number, words: boolean, measure: MeasureText): string[] {
  const lines: string[] = [];
  let current = "";
  for (const character of Array.from(text)) {
    if (current && measure(current + character) > width) {
      const breakAt = words ? current.search(/\s+\S*$/) : -1;
      if (breakAt > 0) {
        lines.push(current.slice(0, breakAt));
        current = current.slice(breakAt).trimStart();
      } else {
        lines.push(words ? current.trimEnd() : current);
        current = "";
      }
      if (words && !current && /\s/.test(character)) continue;
      if (current && measure(current + character) > width) {
        lines.push(current);
        current = "";
      }
    }
    current += character;
  }
  if (current || !lines.length) lines.push(words ? current.trimEnd() : current);
  return lines;
}
export function layoutText(
  text: string,
  width: number,
  mode: LineBreak,
  maximumLines: number,
  measure: MeasureText,
): string[] {
  if (!text || width <= 0) return [];
  const paragraphs = text.split(/\r\n|\r|\n/);
  const lines = paragraphs.flatMap((paragraph) =>
    mode === LineBreak.Word || mode === LineBreak.Character
      ? wrap(paragraph, width, mode === LineBreak.Word, measure)
      : [truncate(paragraph, width, mode, measure)],
  );
  return maximumLines > 0 ? lines.slice(0, maximumLines) : lines;
}
