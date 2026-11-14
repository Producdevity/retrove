export const UNICODE_CHARACTER_LIMIT = 0x110000;
const DECIMAL_RADIX = 10;
const DECIMAL_ZEROES = "0٠۰߀०০੦૦୦௦౦೦൦෦๐໐༠၀႐០᠐᥆᧐᪀᪐᭐᮰᱀᱐꘠꣐꤀꧐꧰꩐꯰０";

export function decimalValue(character: string): number | undefined {
  const code = character.charCodeAt(0);
  for (const zero of DECIMAL_ZEROES) {
    const digit = code - zero.charCodeAt(0);
    if (digit >= 0 && digit < DECIMAL_RADIX) return digit;
  }
  return undefined;
}

export class CharacterSet {
  constructor(private readonly predicate: (character: string) => boolean) {}
  contains(character: string): boolean {
    return character.length > 0 && this.predicate(character);
  }
  inverted(): CharacterSet {
    return new CharacterSet((character) => !this.contains(character));
  }
  union(other: CharacterSet): CharacterSet {
    return new CharacterSet((character) => this.contains(character) || other.contains(character));
  }
  intersection(other: CharacterSet): CharacterSet {
    return new CharacterSet((character) => this.contains(character) && other.contains(character));
  }
  subtract(other: CharacterSet): CharacterSet {
    return new CharacterSet((character) => this.contains(character) && !other.contains(character));
  }
  static range(location: number, length: number): CharacterSet {
    if (
      !Number.isInteger(location) ||
      !Number.isInteger(length) ||
      location < 0 ||
      length < 0 ||
      location + length > UNICODE_CHARACTER_LIMIT
    )
      throw new Error("NSCharacterSet range exceeds Unicode character space.");
    return new CharacterSet((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && code >= location && code < location + length;
    });
  }
  static characters(value: string): CharacterSet {
    const characters = new Set(value);
    return new CharacterSet((character) => characters.has(character));
  }
  static decimal(): CharacterSet {
    return new CharacterSet((character) => decimalValue(character) !== undefined);
  }
  static whitespace(): CharacterSet {
    return new CharacterSet((character) => /[\t\p{Zs}\u200B]/u.test(character));
  }
  static whitespaceAndNewline(): CharacterSet {
    return new CharacterSet((character) =>
      /[\t-\r\p{Zs}\u0085\u200B\u2028\u2029]/u.test(character),
    );
  }
  static empty(): CharacterSet {
    return new CharacterSet(() => false);
  }
}
