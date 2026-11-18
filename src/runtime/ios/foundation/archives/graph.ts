export const ARCHIVE_VERSION = 100000;
const MAX_DECODE_DEPTH = 128;
export type ArchiveFields = Record<string, unknown>;
/** Marks an object Interface Builder archived as a UICustomObject, which is created with -init. */
export const CUSTOM_OBJECT_KEY = "RetroveNibCustomObject";
const CLASS_SWAPPER = "UIClassSwapper";
const CUSTOM_OBJECT = "UICustomObject";

export class ArchiveReference {
  constructor(readonly index: number) {
    if (!Number.isSafeInteger(index) || index < 0) throw Error("Invalid archive reference");
  }
}
export function archiveFields(value: unknown): ArchiveFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error("Invalid keyed archive dictionary");
  }
  return Object.fromEntries(Object.entries(value));
}
export function archiveArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw Error("Invalid keyed archive array");
  return value;
}
interface ArchiveHost {
  scalar(value: unknown): number;
  allocate(className: string): number;
  /** Whether the runtime knows the class; swapped nib classes fall back to the original. */
  hasClass(className: string): boolean;
  initialize(pointer: number, className: string, fields: ArchiveFields): Promise<number>;
  release(pointer: number): Promise<void>;
}

export class ArchiveGraph {
  readonly top: ArchiveFields;
  private readonly objects: unknown[];
  private readonly decoded = new Map<number, number>();
  private readonly ownership = new Set<number>();
  private depth = 0;
  private failed = false;

  constructor(
    value: unknown,
    private readonly host: ArchiveHost,
  ) {
    const archive = archiveFields(value);
    if (archive.$archiver !== "NSKeyedArchiver" || archive.$version !== ARCHIVE_VERSION) {
      throw Error("Unsupported keyed archive format");
    }
    this.objects = archiveArray(archive.$objects);
    if (this.objects[0] !== "$null") throw Error("Invalid keyed archive null object");
    this.top = archiveFields(archive.$top);
  }
  private reference(value: unknown): number {
    const index = value instanceof ArchiveReference ? value.index : archiveFields(value)["CF$UID"];
    if (
      typeof index !== "number" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.objects.length
    ) {
      throw Error("Invalid keyed archive object reference");
    }
    return index;
  }
  async decode(value: unknown): Promise<number> {
    if (this.failed) throw Error("Keyed archive decoding has failed");
    if (value === undefined) return 0;
    const index = this.reference(value);
    if (index === 0) return 0;
    const cached = this.decoded.get(index);
    if (cached !== undefined) return cached;
    if (++this.depth > MAX_DECODE_DEPTH) {
      this.depth--;
      throw Error("Keyed archive nesting limit exceeded");
    }
    try {
      return await this.instantiate(index);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.depth--;
    }
  }
  private async instantiate(index: number): Promise<number> {
    const value = this.objects[index];
    if (
      typeof value !== "object" ||
      value === null ||
      value instanceof Uint8Array ||
      value instanceof Date
    ) {
      const pointer = this.host.scalar(value);
      this.ownership.add(pointer);
      this.decoded.set(index, pointer);
      return pointer;
    }
    const fields = archiveFields(value);
    const descriptor = archiveFields(this.objects[this.reference(fields.$class)]);
    const archived = descriptor.$classname;
    if (typeof archived !== "string") throw Error("Invalid keyed archive class name");
    const className = archived === CLASS_SWAPPER ? this.swapped(fields) : archived;
    const pointer = this.host.allocate(className);
    this.ownership.add(pointer);
    this.decoded.set(index, pointer);
    const initialized = await this.host.initialize(pointer, className, fields);
    if (initialized !== pointer) {
      this.ownership.delete(pointer);
      this.ownership.add(initialized);
      this.decoded.set(index, initialized);
    }
    return initialized;
  }
  /** Interface Builder's stand-in for a custom class: use it, or the original when missing. */
  private swapped(fields: ArchiveFields): string {
    const name = (key: string) => {
      const value =
        fields[key] === undefined ? undefined : this.objects[this.reference(fields[key])];
      if (typeof value !== "string") throw Error(`Invalid ${CLASS_SWAPPER} ${key}`);
      return value;
    };
    const original = name("UIOriginalClassName"),
      custom = name("UIClassName");
    if (original === CUSTOM_OBJECT) fields[CUSTOM_OBJECT_KEY] = true;
    if (this.host.hasClass(custom)) return custom;
    if (original === CUSTOM_OBJECT) throw Error(`Unknown archived class ${custom}`);
    return original;
  }
  async dispose(): Promise<void> {
    const pointers = [...this.ownership];
    this.ownership.clear();
    this.decoded.clear();
    for (const pointer of pointers) await this.host.release(pointer);
  }
}

export function archiveKey(key: string): string {
  return key.startsWith("$") ? "$" + key : key;
}
