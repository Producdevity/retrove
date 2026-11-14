import { expect, test } from "vite-plus/test";
import { Alerts } from "./model";
import { AlertCallback } from "./types";
import type { AlertLifecycleHost } from "./types";
function fixture(cancelHandler = false) {
  const events: [string, number[], boolean][] = [];
  let references = 1,
    closed = 0,
    selections: ((index: number | undefined) => void) | undefined;
  const host: AlertLifecycleHost = {
    retain: (pointer) => {
      references++;
      return pointer;
    },
    release: async () => {
      references--;
    },
    deallocateView: async () => {},
    responds: (_pointer, selector) => cancelHandler && selector === AlertCallback.Cancel,
    send: async (_pointer, selector, args = []) => {
      events.push([selector, args, alerts.visible(10)]);
    },
  };
  const alerts = new Alerts(host, (_content, select) => {
    selections = select;
    return {
      update: () => {},
      close: () => {
        closed++;
      },
    };
  });
  alerts.get(10).delegate = 20;
  alerts.get(10).buttons = ["Cancel", "Continue"];
  alerts.get(10).cancel = 0;
  return {
    alerts,
    events,
    refs: () => references,
    closed: () => closed,
    select: (index: number | undefined) => selections?.(index),
  };
}
test("alerts queue actual button choices, retain presentation, and deliver ordered main-pump callbacks once", async () => {
  const x = fixture();
  await x.alerts.show(10);
  await x.alerts.show(10);
  expect(x.refs()).toBe(2);
  expect(x.alerts.pending()).toBe(true);
  x.select(1);
  x.select(0);
  expect(x.events.map((event) => event[0])).toEqual([
    AlertCallback.WillPresent,
    AlertCallback.DidPresent,
  ]);
  await x.alerts.pump();
  await x.alerts.pump();
  expect(x.events).toEqual([
    [AlertCallback.WillPresent, [10], true],
    [AlertCallback.DidPresent, [10], true],
    [AlertCallback.Click, [10, 1], true],
    [AlertCallback.WillDismiss, [10, 1], true],
    [AlertCallback.DidDismiss, [10, 1], false],
  ]);
  expect(x.refs()).toBe(1);
  expect(x.closed()).toBe(1);
  expect(x.alerts.pending()).toBe(false);
});
test("programmatic dismissal sends dismissal notifications without a fabricated user click", async () => {
  const x = fixture();
  await x.alerts.show(10);
  await x.alerts.dismiss(10, -1);
  expect(x.events.map((event) => event[0])).toEqual([
    AlertCallback.WillPresent,
    AlertCallback.DidPresent,
    AlertCallback.WillDismiss,
    AlertCallback.DidDismiss,
  ]);
  expect(x.refs()).toBe(1);
});
test("system cancellation differs from tapping the cancel button, and falls back to that button without a handler", async () => {
  for (const handlesCancel of [false, true]) {
    const x = fixture(handlesCancel);
    await x.alerts.show(10);
    x.select(undefined);
    await x.alerts.pump();
    expect(x.events[2]).toEqual(
      handlesCancel ? [AlertCallback.Cancel, [10], true] : [AlertCallback.Click, [10, 0], true],
    );
    expect(x.refs()).toBe(1);
  }
});
test("closing the runtime removes visible dialogs and discards stale browser choices", async () => {
  const x = fixture();
  await x.alerts.show(10);
  x.select(1);
  x.alerts.close();
  await x.alerts.pump();
  expect(x.closed()).toBe(1);
  expect(x.events).toHaveLength(2);
  expect(x.alerts.pending()).toBe(false);
});
