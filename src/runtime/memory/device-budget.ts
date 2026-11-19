const STORAGE_KEY = "retrove.deviceBudget";
const RECORD_VERSION = 1;
const WASM_PAGE_BYTES = 65_536;
const MEBIBYTE = 1_048_576;
const STEP_MB = 256;
/** Enough to tell every budget tier apart; reserving more only puts the page at risk. */
const CHECK_LIMIT_MB = 3072;
/** The translator's arena (1 GiB guest span plus tables, about 1.3 GiB) next to Unicorn's own heap. */
const TRANSLATION_RESERVE_MB = 2048;
/** Below this the code budget is reduced. */
const FULL_RESERVE_MB = 3072;
/** `navigator.deviceMemory` (GB, Chromium only) below this reduces the code budget. */
const FULL_DEVICE_GB = 4;
export const CodeBudgetBytes = { Full: 67_108_864, Reduced: 33_554_432 } as const;

/** Reserve check progress, written before and after every step so a killed page leaves its limit. */
interface ReserveRecord {
  readonly version: typeof RECORD_VERSION;
  readonly reserveMB: number;
  readonly attemptMB: number;
  readonly done: boolean;
}
export interface DeviceBudget {
  /** Whether a reserve check finished, or was cut short by the page being killed. */
  readonly measured: boolean;
  readonly reserveMB: number;
  /** The translated tier's arena fits; without it games run on the interpreter alone. */
  readonly translation: boolean;
  readonly codeBytes: number;
}
type BudgetStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): BudgetStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function browserDeviceMemory(): number | undefined {
  const value: unknown = Reflect.get(globalThis.navigator ?? {}, "deviceMemory");
  return typeof value === "number" && value > 0 ? value : undefined;
}
function readRecord(storage: BudgetStorage | undefined): ReserveRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const reserveMB: unknown = Reflect.get(value, "reserveMB"),
    attemptMB: unknown = Reflect.get(value, "attemptMB"),
    done: unknown = Reflect.get(value, "done");
  if (Reflect.get(value, "version") !== RECORD_VERSION) return undefined;
  if (typeof reserveMB !== "number" || typeof attemptMB !== "number" || typeof done !== "boolean")
    return undefined;
  return { version: RECORD_VERSION, reserveMB, attemptMB, done };
}
function writeRecord(storage: BudgetStorage | undefined, record: ReserveRecord): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Without storage the check reruns next time; budgets keep their defaults meanwhile.
  }
}

/** Budgets for this device from its saved reserve check; defaults until a check has run. */
export function deviceBudget(
  storage = browserStorage(),
  deviceMemoryGB = browserDeviceMemory(),
): DeviceBudget {
  const record = readRecord(storage);
  const measured = !!record && (record.done || record.attemptMB > record.reserveMB);
  const reserveMB = measured ? record.reserveMB : CHECK_LIMIT_MB;
  const small =
    reserveMB < FULL_RESERVE_MB ||
    (deviceMemoryGB !== undefined && deviceMemoryGB < FULL_DEVICE_GB);
  return {
    measured,
    reserveMB,
    translation: reserveMB >= TRANSLATION_RESERVE_MB,
    codeBytes: small ? CodeBudgetBytes.Reduced : CodeBudgetBytes.Full,
  };
}

export interface ReserveCheck {
  readonly storage?: BudgetStorage | undefined;
  /** Grows a fresh memory by `pages`; throws when the engine refuses. */
  readonly grow?: (pages: number) => void;
  readonly pause?: () => Promise<void>;
}
const stepPages = (STEP_MB * MEBIBYTE) / WASM_PAGE_BYTES;

/**
 * Measures once per device how far one Wasm memory can be reserved, in steps. Safari may kill the
 * page instead of failing a step, so each attempt is saved first and a later check stops there.
 */
export async function checkDeviceReserve(check: ReserveCheck = {}): Promise<void> {
  const storage = check.storage ?? browserStorage();
  const previous = readRecord(storage);
  if (previous?.done) return;
  if (previous && previous.attemptMB > previous.reserveMB)
    return writeRecord(storage, { ...previous, done: true });
  const memory = check.grow ? undefined : new WebAssembly.Memory({ initial: 0 });
  const grow = check.grow ?? ((pages: number) => memory?.grow(pages));
  const pause = check.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let reserveMB = 0;
  for (let attemptMB = STEP_MB; attemptMB <= CHECK_LIMIT_MB; attemptMB += STEP_MB) {
    writeRecord(storage, { version: RECORD_VERSION, reserveMB, attemptMB, done: false });
    try {
      grow(stepPages);
    } catch {
      break;
    }
    reserveMB = attemptMB;
    await pause();
  }
  writeRecord(storage, { version: RECORD_VERSION, reserveMB, attemptMB: reserveMB, done: true });
}
