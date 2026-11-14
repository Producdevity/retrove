import { ARCHIVE_VERSION, ArchiveReference, type ArchiveFields } from "./graph";

const MAX_DEPTH = 128;
interface EncoderHost {
  classes(pointer: number): string[];
  scalar(pointer: number): string | number | boolean | bigint | undefined;
  encode(pointer: number, name: string, fields: ArchiveFields): Promise<void>;
}
export class ArchiveEncoder {
  readonly top: ArchiveFields = {};
  private readonly objects: unknown[] = ["$null"];
  private readonly references = new Map<number, ArchiveReference>();
  private readonly descriptors = new Map<string, ArchiveReference>();
  private readonly conditional: { fields: ArchiveFields; key: string; pointer: number }[] = [];
  private depth = 0;
  private failed = false;
  constructor(private readonly host: EncoderHost) {}
  async encode(pointer: number): Promise<ArchiveReference> {
    if (this.failed) throw Error("Keyed archive encoding has failed");
    if (!pointer) return new ArchiveReference(0);
    const cached = this.references.get(pointer);
    if (cached) return cached;
    if (++this.depth > MAX_DEPTH) {
      this.depth--;
      throw Error("Keyed archive nesting limit exceeded");
    }
    try {
      return await this.insert(pointer);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.depth--;
    }
  }
  private async insert(pointer: number) {
    const reference = new ArchiveReference(this.objects.length);
    this.references.set(pointer, reference);
    const scalar = this.host.scalar(pointer);
    if (scalar !== undefined) {
      this.objects.push(scalar);
      return reference;
    }
    const fields: ArchiveFields = {};
    this.objects.push(fields);
    const classes = this.host.classes(pointer),
      name = classes[0];
    if (!name) throw Error("Missing archived class");
    await this.host.encode(pointer, name, fields);
    let descriptor = this.descriptors.get(name);
    if (!descriptor) {
      descriptor = new ArchiveReference(this.objects.length);
      this.objects.push({ $classname: name, $classes: classes });
      this.descriptors.set(name, descriptor);
    }
    fields.$class = descriptor;
    return reference;
  }
  encodeConditional(fields: ArchiveFields, key: string, pointer: number) {
    this.conditional.push({ fields, key, pointer });
  }
  finish(): unknown {
    if (this.failed) throw Error("Keyed archive encoding has failed");
    for (const { fields, key, pointer } of this.conditional)
      fields[key] = this.references.get(pointer) ?? new ArchiveReference(0);
    return {
      $archiver: "NSKeyedArchiver",
      $version: ARCHIVE_VERSION,
      $objects: this.objects,
      $top: this.top,
    };
  }
}
