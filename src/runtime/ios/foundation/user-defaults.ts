import { floatBits, floatFromBits, WORD_BYTES } from "../abi/scalars";
import { Argument, type FoundationHost } from "../objc/host";

const DEFAULTS_CLASS = "NSUserDefaults";
const GLOBAL_DOMAIN = "NSGlobalDomain";
const DOUBLE_BYTES = Float64Array.BYTES_PER_ELEMENT;
type PreferenceValue =
  | string
  | number
  | boolean
  | readonly PreferenceValue[]
  | PreferenceDictionary;
interface PreferenceDictionary {
  readonly [key: string]: PreferenceValue;
}
interface DefaultsStorage {
  read(): unknown;
  write(values: PreferenceDictionary): boolean;
}
interface DefaultsHost extends Pick<FoundationHost, "hostClass" | "method" | "text" | "string"> {
  readonly identifier: string;
  readonly globals: unknown;
  readonly storage: DefaultsStorage;
  singleton(name: string): () => number;
  property(value: unknown): number;
  unbox(pointer: number): unknown;
}
function preference(value: unknown): PreferenceValue {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(preference);
  }
  return dictionary(value);
}
function dictionary(value: unknown): PreferenceDictionary {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Expected a preferences dictionary.");
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, preference(item)]));
}
export class UserDefaults {
  readonly #application = new Map<string, PreferenceValue>();
  readonly #registration = new Map<string, PreferenceValue>();
  readonly #global: PreferenceDictionary;
  constructor(saved: unknown = {}, globals: unknown = {}) {
    this.#global = dictionary(globals);
    try {
      for (const [key, value] of Object.entries(dictionary(saved)))
        this.#application.set(key, value);
    } catch {
      this.#application.clear();
    }
  }
  register(values: unknown): void {
    for (const [key, value] of Object.entries(dictionary(values)))
      this.#registration.set(key, value);
  }
  get(key: string): PreferenceValue | undefined {
    return (
      this.#application.get(key) ??
      (Object.hasOwn(this.#global, key) ? this.#global[key] : undefined) ??
      this.#registration.get(key)
    );
  }
  set(key: string, value: unknown): void {
    if (value === undefined || value === null) this.#application.delete(key);
    else this.#application.set(key, preference(value));
  }
  persistent(): PreferenceDictionary {
    return Object.fromEntries(this.#application);
  }
  global(): PreferenceDictionary {
    return this.#global;
  }
  representation(): PreferenceDictionary {
    return { ...Object.fromEntries(this.#registration), ...this.#global, ...this.persistent() };
  }
}
export function installUserDefaults(host: DefaultsHost): void {
  host.hostClass(DEFAULTS_CLASS, "NSObject");
  const defaults = new UserDefaults(host.storage.read(), host.globals);
  const bits = new DataView(new ArrayBuffer(DOUBLE_BYTES));
  const value = (key: number) => defaults.get(host.text(key));
  const sync = () => Number(host.storage.write(defaults.persistent()));
  const set = (key: number, item: unknown) => {
    defaults.set(host.text(key), item);
    sync();
  };
  host.method(DEFAULTS_CLASS, true, "standardUserDefaults", host.singleton(DEFAULTS_CLASS));
  host.method(DEFAULTS_CLASS, false, "registerDefaults:", (_, args) =>
    defaults.register(host.unbox(args(Argument.First))),
  );
  host.method(DEFAULTS_CLASS, false, "objectForKey:", (_, args) =>
    host.property(value(args(Argument.First))),
  );
  host.method(DEFAULTS_CLASS, false, "stringForKey:", (_, args) => {
    const item = value(args(Argument.First));
    if (typeof item === "string" || typeof item === "number") return host.string(String(item));
    return typeof item === "boolean" ? host.string(String(Number(item))) : 0;
  });
  host.method(
    DEFAULTS_CLASS,
    false,
    "integerForKey:",
    (_, args) => Number(value(args(Argument.First))) | 0,
  );
  host.method(DEFAULTS_CLASS, false, "boolForKey:", (_, args) => {
    const item = value(args(Argument.First));
    return Number(typeof item === "string" ? /^(?:y|t|[1-9])/i.test(item) : Boolean(item));
  });
  host.method(DEFAULTS_CLASS, false, "floatForKey:", (_, args) =>
    floatBits(Number(value(args(Argument.First))) || 0),
  );
  host.method(DEFAULTS_CLASS, false, "doubleForKey:", (_, args) => {
    bits.setFloat64(0, Number(value(args(Argument.First))) || 0, true);
    return bits.getBigUint64(0, true);
  });
  host.method(DEFAULTS_CLASS, false, "setInteger:forKey:", (_, args) =>
    set(args(Argument.Second), args(Argument.First) | 0),
  );
  host.method(DEFAULTS_CLASS, false, "setBool:forKey:", (_, args) =>
    set(args(Argument.Second), Boolean(args(Argument.First))),
  );
  host.method(DEFAULTS_CLASS, false, "setFloat:forKey:", (_, args) =>
    set(args(Argument.Second), floatFromBits(args(Argument.First))),
  );
  host.method(DEFAULTS_CLASS, false, "setObject:forKey:", (_, args) =>
    set(args(Argument.Second), host.unbox(args(Argument.First))),
  );
  host.method(DEFAULTS_CLASS, false, "setDouble:forKey:", (_, args) => {
    bits.setUint32(0, args(Argument.First), true);
    bits.setUint32(WORD_BYTES, args(Argument.Second), true);
    set(args(Argument.Third), bits.getFloat64(0, true));
  });
  host.method(DEFAULTS_CLASS, false, "removeObjectForKey:", (_, args) =>
    set(args(Argument.First), undefined),
  );
  host.method(DEFAULTS_CLASS, false, "dictionaryRepresentation", () =>
    host.property(defaults.representation()),
  );
  host.method(DEFAULTS_CLASS, false, "persistentDomainForName:", (_, args) => {
    const name = host.text(args(Argument.First));
    return name === host.identifier
      ? host.property(defaults.persistent())
      : name === GLOBAL_DOMAIN
        ? host.property(defaults.global())
        : 0;
  });
  host.method(DEFAULTS_CLASS, false, "synchronize", sync);
}
