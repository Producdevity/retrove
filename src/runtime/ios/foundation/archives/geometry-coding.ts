import { floatBits, floatFromBits, WORD_BYTES } from "../../abi/scalars";
import type { FoundationHost, GuestArguments, StructureMethod } from "../../objc/host";

const ARCHIVER = "NSKeyedArchiver";
const UNARCHIVER = "NSKeyedUnarchiver";
/** %g keeps six significant digits, as NSStringFromCGPoint and friends format them. */
const SIGNIFICANT_DIGITS = 6;
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
/** Float counts and the brace layout UIKit writes for each geometry type. */
const Floats = { Pair: 2, Quad: 4, Transform: 6 } as const;
const braces = (v: readonly string[]) => `{${v.join(", ")}}`;
const rect = (v: readonly string[]) =>
  braces([braces(v.slice(0, Floats.Pair)), braces(v.slice(Floats.Pair))]);
const GEOMETRY = [
  ["CGPoint", Floats.Pair, braces],
  ["CGSize", Floats.Pair, braces],
  ["CGRect", Floats.Quad, rect],
  ["CGAffineTransform", Floats.Transform, (v: readonly string[]) => `[${v.join(", ")}]`],
  ["UIEdgeInsets", Floats.Quad, braces],
] as const;

interface GeometryHost extends Pick<FoundationHost, "method" | "string" | "text" | "write"> {
  send(pointer: number, selector: string, args: number[]): Promise<number>;
  structure(className: string, selector: string, implementation: StructureMethod): void;
}

export function geometryText(
  values: readonly number[],
  layout: (v: readonly string[]) => string,
): string {
  return layout(values.map((value) => String(Number(value.toPrecision(SIGNIFICANT_DIGITS)))));
}
/** The numbers in a geometry string, or zeros when it does not hold exactly `count`. */
export function geometryValues(text: string, count: number): number[] {
  const values = (text.match(NUMBER) ?? []).map(Number);
  return values.length === count && values.every(Number.isFinite)
    ? values
    : new Array<number>(count).fill(0);
}

/** NSCoder's UIKit geometry methods: values travel as strings such as "{1, 2}". */
export function installGeometryCoding(host: GeometryHost): void {
  for (const [name, count, layout] of GEOMETRY) {
    host.method(ARCHIVER, false, `encode${name}:forKey:`, (self, args: GuestArguments) => {
      const values = Array.from({ length: count }, (_, index) => floatFromBits(args(index)));
      return host.send(self, "encodeObject:forKey:", [
        host.string(geometryText(values, layout)),
        args(count),
      ]);
    });
    host.structure(
      UNARCHIVER,
      `decode${name}ForKey:`,
      Object.assign(
        async (self: number, args: GuestArguments, destination: number) => {
          const value = await host.send(self, "decodeObjectForKey:", [args(0)]);
          const values = value ? geometryValues(host.text(value), count) : [];
          for (let index = 0; index < count; index++)
            host.write(destination + index * WORD_BYTES, floatBits(values[index] ?? 0));
        },
        { stret: true as const },
      ),
    );
  }
}
