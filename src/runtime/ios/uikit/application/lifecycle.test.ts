import { expect, test } from "vite-plus/test";
import { ApplicationLifecycle, ApplicationState, LifecycleEvent } from "./lifecycle";
class Visibility extends EventTarget {
  hidden = false;
  show(visible: boolean): void {
    this.hidden = !visible;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
test("background and foreground callbacks retain order across a queued visibility burst", async () => {
  const source = new Visibility(),
    calls: string[] = [];
  const lifecycle = new ApplicationLifecycle({
    delegate: (selector) => {
      calls.push(selector);
      return Promise.resolve();
    },
    notify: (name) => {
      calls.push(name);
      return Promise.resolve();
    },
  });
  expect(lifecycle.state).toBe(ApplicationState.Inactive);
  await lifecycle.start(source);
  expect(lifecycle.active).toBe(true);
  source.show(false);
  source.show(false);
  source.show(true);
  await lifecycle.pump();
  expect(calls).toEqual([
    LifecycleEvent.Active.selector,
    LifecycleEvent.Active.notification,
    LifecycleEvent.Inactive.selector,
    LifecycleEvent.Inactive.notification,
    LifecycleEvent.Background.selector,
    LifecycleEvent.Background.notification,
    LifecycleEvent.Foreground.notification,
    LifecycleEvent.Foreground.selector,
    LifecycleEvent.Active.selector,
    LifecycleEvent.Active.notification,
  ]);
  expect(lifecycle.state).toBe(ApplicationState.Active);
  lifecycle.close();
  source.show(false);
  await lifecycle.pump();
  expect(calls).toHaveLength(10);
});
test("a hidden launch enters background without a false active transition", async () => {
  const source = new Visibility(),
    selectors: string[] = [];
  source.show(false);
  const lifecycle = new ApplicationLifecycle({
    delegate: (selector) => {
      selectors.push(selector);
      return Promise.resolve();
    },
    notify: () => Promise.resolve(),
  });
  try {
    await lifecycle.start(source);
    expect(lifecycle.state).toBe(ApplicationState.Background);
    expect(selectors).toEqual([LifecycleEvent.Background.selector]);
    await expect(lifecycle.start(source)).rejects.toThrow(/twice/);
  } finally {
    lifecycle.close();
  }
});
