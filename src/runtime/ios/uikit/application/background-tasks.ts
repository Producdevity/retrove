import { Argument, type FoundationHost } from "../../objc/host";

interface BackgroundTaskHost extends Pick<FoundationHost, "method"> {
  /** UIApplicationState; 0 is active. */
  state(): number;
  copyBlock(block: number): Promise<number>;
  releaseBlock(block: number): Promise<void>;
}
const APPLICATION_CLASS = "UIApplication";
/** UIBackgroundTaskInvalid. */
const INVALID = 0;
const ACTIVE = 0;
const DOUBLE_BYTES = 8;

function doubleBits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  view.setFloat64(0, value, true);
  return view.getBigUint64(0, true);
}

/**
 * A hidden page is frozen by the browser, so no task ever gets background time. Tasks are
 * granted and their expiration handlers held until the app ends them.
 */
export function installBackgroundTasks(host: BackgroundTaskHost): void {
  const handlers = new Map<number, number>();
  let next = INVALID;
  const begin = async (block: number): Promise<number> => {
    next += 1;
    handlers.set(next, block ? await host.copyBlock(block) : 0);
    return next;
  };
  host.method(
    APPLICATION_CLASS,
    false,
    "beginBackgroundTaskWithExpirationHandler:",
    (_self, args) => begin(args(Argument.First)),
  );
  host.method(
    APPLICATION_CLASS,
    false,
    "beginBackgroundTaskWithName:expirationHandler:",
    (_self, args) => begin(args(Argument.Second)),
  );
  host.method(APPLICATION_CLASS, false, "endBackgroundTask:", async (_self, args) => {
    const block = handlers.get(args(Argument.First));
    handlers.delete(args(Argument.First));
    if (block) await host.releaseBlock(block);
  });
  host.method(APPLICATION_CLASS, false, "backgroundTimeRemaining", () =>
    doubleBits(host.state() === ACTIVE ? Number.MAX_VALUE : 0),
  );
}
