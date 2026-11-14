const ARCHIVE_VERSION = 100000;
const MAX_DECODE_DEPTH = 128;
export type ArchiveFields = Record<string, unknown>;

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
    const className = descriptor.$classname;
    if (typeof className !== "string") throw Error("Invalid keyed archive class name");
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
  async dispose(): Promise<void> {
    const pointers = [...this.ownership];
    this.ownership.clear();
    this.decoded.clear();
    for (const pointer of pointers) await this.host.release(pointer);
  }
}
