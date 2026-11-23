const RANGE_SPAN = 2;

/** Parses the characters after `%[` up to the closing bracket; returns the matcher and the format index after it. */
export function parseScanset(
  format: string,
  start: number,
): { matches: (character: string) => boolean; end: number } {
  let at = start;
  const negate = format[at] === "^";
  if (negate) at++;
  const first = at;
  if (format[at] === "]") at++;
  while (at < format.length && format[at] !== "]") at++;
  if (at >= format.length) throw new Error("Unclosed guest scanf scanset");
  const set = format.slice(first, at++);
  const inSet = (character: string): boolean => {
    for (let index = 0; index < set.length; index++) {
      if (set[index + 1] === "-" && index + RANGE_SPAN < set.length) {
        if (character >= (set[index] ?? "") && character <= (set[index + RANGE_SPAN] ?? ""))
          return true;
        index += RANGE_SPAN;
      } else if (character === set[index]) return true;
    }
    return false;
  };
  return { matches: (character) => inSet(character) !== negate, end: at };
}
