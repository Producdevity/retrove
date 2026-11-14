import { expect, test } from "vite-plus/test";
import { dispatchXML } from "./dispatch";
test("native XML CDATA falls back to foundCharacters only when foundCDATA is absent", async () => {
  for (const hasCDATA of [false, true]) {
    let pointer = 100;
    const values = new Map<number, unknown>(),
      received: { selector: string; value: unknown }[] = [];
    const value = (input: unknown) => {
      values.set(++pointer, input);
      return pointer;
    };
    const host = {
      string: (text: string) => value(text),
      data: (bytes: Uint8Array) => value(bytes),
      dictionary: () => {
        throw new Error("Unexpected attributes");
      },
      responds: (_delegate: number, selector: string) =>
        selector === "parser:foundCDATA:" && hasCDATA,
      send: async (_delegate: number, selector: string, args: number[]) => {
        expect(args[0]).toBe(42);
        received.push({ selector, value: values.get(args[1] ?? 0) });
      },
    };
    for (const text of ["0123456789é", ""])
      await dispatchXML(host, 1, 42, { kind: "cdata", value: text });
    expect(received).toEqual(
      ["0123456789é", ""].map((text) => ({
        selector: hasCDATA ? "parser:foundCDATA:" : "parser:foundCharacters:",
        value: hasCDATA ? new TextEncoder().encode(text) : text,
      })),
    );
  }
});
