import { expect, test, vi } from "vite-plus/test";
import { PointerPhase, PointerQueue } from "./pointer-queue";
import { startTouchTest } from "../../../../../tests/touch-browser.mjs";
import type { TouchHarness } from "../../../../../tests/touch-browser.mjs";
test("queued bursts preserve press, last movement and release on separate guest turns", () => {
  const queue = new PointerQueue();
  for (const [type, x] of [
    [PointerPhase.Down, 0],
    [PointerPhase.Move, 10],
    [PointerPhase.Move, 20],
    [PointerPhase.Up, 20],
  ] as const)
    queue.push({ id: 1, type, point: [x, 0], time: x });
  expect(queue.length).toBe(3);
  expect(queue.coalesced).toBe(1);
  expect(queue.takeTurn().map((event) => event.type)).toEqual([PointerPhase.Down]);
  expect(queue.takeTurn().map((event) => event.point)).toEqual([[20, 0]]);
  expect(queue.takeTurn().map((event) => event.type)).toEqual([PointerPhase.Up]);
  expect(queue.length).toBe(0);
});
class Canvas extends EventTarget {
  readonly style = { touchAction: "" };
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 100 };
  }
  pointer(type: string, id: number, x: number, y: number): void {
    this.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        pointerType: "touch",
        pointerId: id,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      }),
    );
  }
}
test("the UIKit loop advances guest work between touch phases and marks other fingers stationary", async () => {
  const canvas = new Canvas(),
    turns: number[][] = [];
  let harness: TouchHarness | undefined,
    queued = false,
    complete = false,
    offset = 0;
  const onTurn = () => {
    if (!queued) {
      queued = true;
      canvas.pointer("pointerdown", 1, 30, 40);
      canvas.pointer("pointerdown", 2, 40, 50);
      canvas.pointer("pointermove", 1, 60, 40);
      canvas.pointer("pointermove", 1, 100, 40);
      canvas.pointer("pointermove", 2, 120, 50);
      canvas.pointer("pointerup", 1, 100, 40);
      canvas.pointer("pointerup", 2, 120, 50);
      return;
    }
    if (!harness) throw new Error("Missing touch harness.");
    const events = harness.events.slice(offset);
    offset = harness.events.length;
    if (events.length) turns.push(events.map((event) => event.phase));
    if (events.some((event) => event.phase === 3)) complete = true;
  };
  harness = await startTouchTest(canvas, undefined, { multiple: true, onTurn });
  try {
    await vi.waitFor(() => expect(complete).toBe(true));
    expect(turns).toEqual([
      [0, 0],
      [1, 1],
      [3, 3],
    ]);
    expect(harness.events.map((event) => event.allPhases)).toEqual([
      [0],
      [2, 0],
      [1, 2],
      [2, 1],
      [3, 2],
      [3],
    ]);
    expect(harness.events.map((event) => event.point)).toEqual([
      [20, 20],
      [30, 30],
      [90, 20],
      [110, 30],
      [90, 20],
      [110, 30],
    ]);
    expect(harness.events.map((event) => event.previous)).toEqual([
      [20, 20],
      [30, 30],
      [20, 20],
      [30, 30],
      [90, 20],
      [110, 30],
    ]);
  } finally {
    await harness.stop();
  }
});
