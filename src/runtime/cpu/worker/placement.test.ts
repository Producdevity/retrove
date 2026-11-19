import { expect, test } from "vite-plus/test";
import { bioShockThreads } from "../../ios/profiles/bioshock/threads";
import { Placement, threadPlacement, type PlacementImage } from "./placement";

/** BioShock 1.3.5 addresses of the symbols its rendering thread rule names. */
const Symbols = new Map([
  [0x186a038, "__ZN21FRunnableThreadIPhone11_ThreadProcEPv"],
  [0x1817a7c, "__ZN18ES2RenderingThread3RunEv"],
  [0x5de390, "__ZN20FFileStreamingThread3RunEv"],
]);
const image: PlacementImage = {
  symbolAt(address) {
    for (const [start, name] of Symbols)
      if (address >= start && address < start + 0x40) return { name, offset: address - start };
    return undefined;
  },
};
const ThreadProc = 0x186a038,
  RenderingRun = 0x1817a7c,
  StreamingRun = 0x5de390;
/** A FRunnableThreadIPhone at 0x1000 whose runnable at 0x2000 has its vtable at 0x3000. */
function memory(run: number): (address: number) => number {
  const words = new Map([
    [0x1000 + 0x0c, 0x2000],
    [0x2000, 0x3000],
    [0x3000 + 4, run],
  ]);
  return (address) => {
    const word = words.get(address);
    if (word === undefined) throw new Error(`unmapped 0x${address.toString(16)}`);
    return word;
  };
}

test("BioShock's rendering thread goes to the graphics worker", () => {
  const place = threadPlacement(bioShockThreads, image, memory(RenderingRun));
  expect(place({ id: 6, pc: ThreadProc, args: [0x1000] })).toBe(Placement.Graphics);
});

test("other Unreal threads started through the same routine stay cooperative", () => {
  const place = threadPlacement(bioShockThreads, image, memory(StreamingRun));
  expect(place({ id: 3, pc: ThreadProc, args: [0x1000] })).toBe(Placement.Cooperative);
});

test("a start routine that is not the rule's entry, or an unreadable argument, stays cooperative", () => {
  const place = threadPlacement(bioShockThreads, image, memory(RenderingRun));
  expect(place({ id: 2, pc: RenderingRun, args: [0x1000] })).toBe(Placement.Cooperative);
  expect(place({ id: 2, pc: ThreadProc + 4, args: [0x1000] })).toBe(Placement.Cooperative);
  expect(place({ id: 2, pc: ThreadProc, args: [0x9000] })).toBe(Placement.Cooperative);
  expect(place({ id: 2, pc: ThreadProc, args: [] })).toBe(Placement.Cooperative);
});

test("a rule without a target matches on the start routine alone, Thumb bit included", () => {
  const place = threadPlacement(
    [{ entry: "__ZN18ES2RenderingThread3RunEv", placement: Placement.Worker }],
    image,
    memory(0),
  );
  expect(place({ id: 2, pc: RenderingRun | 1, args: [] })).toBe(Placement.Worker);
});
