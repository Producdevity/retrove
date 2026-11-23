const TRUNCATION_SUFFIX = " …[truncated]";
const TRUNCATION_MARGIN = 12;
const Limit = {
  Text: 1500,
  Name: 128,
  Stack: 2500,
  Key: 120,
  Depth: 6,
  Nodes: 180,
  Elements: 40,
  Fields: 48,
  Indent: 2,
} as const;
const ERROR_FIELDS = ["code", "faultAddress"] as const;

export function clip(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : String(value);
  return text.length > limit ? text.slice(0, limit - TRUNCATION_MARGIN) + TRUNCATION_SUFFIX : text;
}

interface ErrorFields {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  code?: unknown;
  faultAddress?: unknown;
}

function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isBinary(item: object): item is ArrayBufferView | ArrayBuffer | SharedArrayBuffer {
  return (
    ArrayBuffer.isView(item) ||
    item instanceof ArrayBuffer ||
    (typeof SharedArrayBuffer !== "undefined" && item instanceof SharedArrayBuffer)
  );
}

/** Formats at capture time so no live guest objects or game buffers are retained. */
class Describer {
  private readonly seen = new WeakSet<object>();
  private nodes = 0;

  visit(item: unknown, depth: number): unknown {
    if (
      item === null ||
      item === undefined ||
      typeof item === "boolean" ||
      typeof item === "number"
    )
      return item;
    if (typeof item !== "object") return clip(item, Limit.Text);
    if (isBinary(item)) return `[binary data omitted, ${item.byteLength} bytes]`;
    if (typeof Blob !== "undefined" && item instanceof Blob)
      return `[file data omitted, ${item.size} bytes]`;
    if (depth > Limit.Depth || ++this.nodes > Limit.Nodes) return "[details truncated]";
    if (this.seen.has(item)) return "[circular]";
    this.seen.add(item);
    try {
      if (item instanceof Error) return this.errorFields(item, depth);
      if (Array.isArray(item)) return this.elements(item, depth);
      return this.fields(item, depth);
    } finally {
      this.seen.delete(item);
    }
  }

  error(error: Error): ErrorFields {
    this.nodes++;
    this.seen.add(error);
    try {
      return this.errorFields(error, 0);
    } finally {
      this.seen.delete(error);
    }
  }

  private errorFields(item: Error, depth: number): ErrorFields {
    const result: ErrorFields = {
      name: clip(item.name, Limit.Name),
      message: clip(item.message, Limit.Text),
    };
    if (item.stack) result.stack = clip(item.stack, Limit.Stack);
    if (item.cause !== undefined) result.cause = this.visit(item.cause, depth + 1);
    for (const field of ERROR_FIELDS) {
      const value: unknown = Reflect.get(item, field);
      if (value !== undefined) result[field] = this.visit(value, depth + 1);
    }
    return result;
  }

  private elements(item: readonly unknown[], depth: number): unknown[] {
    const count = Math.min(item.length, Limit.Elements);
    const result = item.slice(0, count).map((element) => this.visit(element, depth + 1));
    if (item.length > count) result.push(`… ${item.length - count} more`);
    return result;
  }

  private fields(item: object, depth: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let count = 0;
    for (const key of Object.keys(item)) {
      if (count++ >= Limit.Fields) {
        setOwn(result, "…", "[remaining fields omitted]");
        break;
      }
      setOwn(result, clip(key, Limit.Key), this.visit(Reflect.get(item, key), depth + 1));
    }
    return result;
  }
}

function scalarText(value: unknown): string {
  if (Array.isArray(value)) return value.map((item: unknown) => scalarText(item)).join(",");
  if (typeof value === "object" && value !== null) return "[object Object]";
  return String(value);
}

function errorText(error: ErrorFields): string {
  return [
    `${error.name}: ${error.message}`,
    error.stack,
    error.cause !== undefined ? `Caused by: ${JSON.stringify(error.cause)}` : null,
    error.code !== undefined ? `Code: ${scalarText(error.code)}` : null,
    error.faultAddress !== undefined ? `Fault address: ${scalarText(error.faultAddress)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function describe(value: unknown, limit: number): string {
  if (value === undefined) return "";
  const describer = new Describer();
  try {
    if (typeof value === "string") return clip(value, limit);
    if (value instanceof Error) return clip(errorText(describer.error(value)), limit);
    return clip(JSON.stringify(describer.visit(value, 0), null, Limit.Indent), limit);
  } catch {
    return "[details unavailable]";
  }
}
