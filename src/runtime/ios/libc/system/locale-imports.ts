import {
  fill,
  readString,
  write32,
  type GuestMemory,
  type Heap,
} from "../../../memory/guest-memory";
import type { SystemImport } from "./types";

const LOCALE_STRING_FIELDS = 10;
const LOCALE_INFO_BYTES = 56;
const LOCALE_CHARACTER_FIELDS = 14;
const CHARACTER_MAXIMUM = 127;
const LAST_CATEGORY = 6;
const WORD_BYTES = 4;

/** The guest environment starts in the portable C locale. */
export function localeImports(cpu: GuestMemory, heap: Heap): Record<string, SystemImport> {
  const cLocale = heap.string("C");
  const decimalPoint = heap.string(".");
  const localeInfo = heap.zero(LOCALE_INFO_BYTES);
  for (let i = 0; i < LOCALE_STRING_FIELDS; i++)
    write32(cpu, localeInfo + WORD_BYTES * i, decimalPoint + (i ? 1 : 0));
  fill(
    cpu,
    localeInfo + WORD_BYTES * LOCALE_STRING_FIELDS,
    CHARACTER_MAXIMUM,
    LOCALE_CHARACTER_FIELDS,
  );
  return {
    _localeconv: () => localeInfo,
    _setlocale: (a) => {
      if (a(0) > LAST_CATEGORY) return 0;
      if (!a(1)) return cLocale;
      const locale = readString(cpu, a(1));
      return locale === "" || locale === "C" || locale === "POSIX" ? cLocale : 0;
    },
  };
}
