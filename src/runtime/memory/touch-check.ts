const STORAGE_KEY = "retrove.deviceTouch";
const RECORD_VERSION = 1;
const MEBIBYTE = 1_048_576;
const WORD_BYTES = 4;
const STEP_MB = 128;
/** Past every budget tier; touching more only puts the page at risk. */
export const TOUCH_LIMIT_MB = 2048;
/** `navigator.deviceMemory` (GB, Chromium only) at or above this skips the check. */
const ROOMY_DEVICE_GB = 8;
const Noise = { Seed: 0x9e3779b9, Left: 13, Right: 17, LeftAgain: 5 } as const;

/** Touch check progress, written before every step so a killed page leaves its limit. */
interface TouchRecord {
  readonly version: typeof RECORD_VERSION;
  readonly touchMB: number;
  readonly attemptMB: number;
  readonly done: boolean;
}
type TouchStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): TouchStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function readRecord(storage: TouchStorage | undefined): TouchRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const touchMB: unknown = Reflect.get(value, "touchMB"),
    attemptMB: unknown = Reflect.get(value, "attemptMB"),
    done: unknown = Reflect.get(value, "done");
  if (Reflect.get(value, "version") !== RECORD_VERSION) return undefined;
  if (typeof touchMB !== "number" || typeof attemptMB !== "number" || typeof done !== "boolean")
    return undefined;
  return { version: RECORD_VERSION, touchMB, attemptMB, done };
}
function writeRecord(storage: TouchStorage | undefined, record: TouchRecord): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the check reruns next time; budgets keep their defaults meanwhile.
  }
}

/** `navigator.deviceMemory` in GB; only Chromium reports it. */
export function browserDeviceMemory(): number | undefined {
  const value: unknown = Reflect.get(globalThis.navigator ?? {}, "deviceMemory");
  return typeof value === "number" && value > 0 ? value : undefined;
}

/** Memory this page kept in use before the system ended it, or undefined until measured. */
export function touchedLimitMB(storage = browserStorage()): number | undefined {
  const record = readRecord(storage);
  if (!record || !(record.done || record.attemptMB > record.touchMB)) return undefined;
  return record.touchMB;
}

/** Incompressible contents, so the system cannot keep the touched pages compressed. */
function fillNoise(words: Uint32Array): void {
  let state: number = Noise.Seed;
  for (let index = 0; index < words.length; index++) {
    state ^= state << Noise.Left;
    state ^= state >>> Noise.Right;
    state ^= state << Noise.LeftAgain;
    words[index] = state;
  }
}

export interface TouchCheck {
  readonly storage?: TouchStorage | undefined;
  readonly deviceMemoryGB?: number | undefined;
  /** Allocates and writes `megabytes` more; throws when the engine refuses. */
  readonly touch?: (megabytes: number) => void;
  readonly pause?: () => Promise<void>;
}

/**
 * Measures once per device how much memory the page can keep in use. iOS ends the page instead
 * of failing an allocation, so each step is saved first and the next check records the limit.
 */
export async function checkDeviceTouch(check: TouchCheck = {}): Promise<void> {
  const storage = check.storage ?? browserStorage();
  const previous = readRecord(storage);
  if (previous?.done) return;
  if (previous && previous.attemptMB > previous.touchMB)
    return writeRecord(storage, { ...previous, done: true });
  if ((check.deviceMemoryGB ?? browserDeviceMemory() ?? 0) >= ROOMY_DEVICE_GB)
    return writeRecord(storage, {
      version: RECORD_VERSION,
      touchMB: TOUCH_LIMIT_MB,
      attemptMB: TOUCH_LIMIT_MB,
      done: true,
    });
  const held: Uint32Array[] = [];
  const touch =
    check.touch ??
    ((megabytes: number) => {
      const words = new Uint32Array((megabytes * MEBIBYTE) / WORD_BYTES);
      fillNoise(words);
      held.push(words);
    });
  const pause = check.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let touchMB = 0;
  for (let attemptMB = STEP_MB; attemptMB <= TOUCH_LIMIT_MB; attemptMB += STEP_MB) {
    writeRecord(storage, { version: RECORD_VERSION, touchMB, attemptMB, done: false });
    try {
      touch(STEP_MB);
    } catch {
      break;
    }
    touchMB = attemptMB;
    await pause();
  }
  held.length = 0;
  writeRecord(storage, { version: RECORD_VERSION, touchMB, attemptMB: touchMB, done: true });
}
