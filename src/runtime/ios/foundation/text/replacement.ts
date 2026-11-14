import { searchText, StringCompareOption, type SearchText } from "./search-text";
const SUPPORTED_OPTIONS = Object.values(StringCompareOption).reduce((mask, flag) => mask | flag, 0);
interface Match {
  start: number;
  end: number;
}
export function validateRange(value: string, location: number, length: number): void {
  if (
    !Number.isSafeInteger(location) ||
    !Number.isSafeInteger(length) ||
    location < 0 ||
    length < 0 ||
    location + length > value.length
  )
    throw new Error("NSString replacement range exceeds bounds.");
}
export function replaceRange(
  value: string,
  replacement: string,
  location: number,
  length: number,
): string {
  validateRange(value, location, length);
  return value.slice(0, location) + replacement + value.slice(location + length);
}
function findMatches(subject: SearchText, target: string, options: number): Match[] {
  const backwards = Boolean(options & StringCompareOption.Backwards),
    anchored = Boolean(options & StringCompareOption.Anchored);
  const matches: Match[] = [];
  let cursor = backwards ? subject.value.length : 0;
  while (backwards ? cursor >= target.length : cursor <= subject.value.length - target.length) {
    const at = backwards
      ? subject.value.lastIndexOf(target, cursor - target.length)
      : subject.value.indexOf(target, cursor);
    if (at < 0 || (anchored && (backwards ? at + target.length !== cursor : at !== cursor))) break;
    const start = subject.boundaries.get(at),
      end = subject.boundaries.get(at + target.length);
    if (start !== undefined && end !== undefined) {
      matches.push({ start, end });
      cursor = backwards ? at : at + target.length;
    } else {
      if (anchored) break;
      cursor = backwards ? at + target.length - 1 : at + 1;
    }
  }
  return backwards ? matches.reverse() : matches;
}
export function replaceOccurrences(
  value: string,
  target: string,
  replacement: string,
  options: number,
  location: number,
  length: number,
) {
  validateRange(value, location, length);
  if (options & ~SUPPORTED_OPTIONS)
    throw new Error("Unsupported NSString replacement options: " + options);
  const subject = searchText(value.slice(location, location + length), options),
    needle = searchText(target, options).value;
  if (!needle.length) return { value, count: 0 };
  const matches = findMatches(subject, needle, options),
    pieces: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    pieces.push(value.slice(cursor, location + match.start), replacement);
    cursor = location + match.end;
  }
  pieces.push(value.slice(cursor));
  return { value: pieces.join(""), count: matches.length };
}
