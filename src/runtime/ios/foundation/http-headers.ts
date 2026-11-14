import type { FoundationHost } from "../objc/host";
const RequestClass = { Base: "NSURLRequest", Mutable: "NSMutableURLRequest" } as const;
const CANONICAL_FIELDS = [
  "Content-Type",
  "Content-Length",
  "Host",
  "Connection",
  "User-Agent",
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Cookie",
  "Referer",
];
const canonicalNames = new Map(CANONICAL_FIELDS.map((name) => [name.toLowerCase(), name]));
export class RequestHeaders {
  private readonly fields = new Map<string, { name: string; value: string }>();
  set(field: string, value: string | undefined): void {
    const key = field.toLowerCase();
    if (value === undefined) this.fields.delete(key);
    else this.fields.set(key, { name: canonicalNames.get(key) ?? field, value });
  }
  add(field: string, value: string): void {
    const previous = this.get(field);
    this.set(field, previous === undefined ? value : previous + "," + value);
  }
  get(field: string): string | undefined {
    return this.fields.get(field.toLowerCase())?.value;
  }
  all(): Record<string, string> {
    return Object.fromEntries([...this.fields.values()].map(({ name, value }) => [name, value]));
  }
}
interface HeaderHost extends Pick<FoundationHost, "method" | "text" | "string"> {
  entries(pointer: number): readonly (readonly [number, number])[];
  isString(pointer: number): boolean;
  isDictionary(pointer: number): boolean;
  property(value: Record<string, string>): number;
}
export function installRequestHeaders(host: HeaderHost): (pointer: number) => void {
  const requests = new Map<number, RequestHeaders>();
  const mutable = (pointer: number) => {
    let fields = requests.get(pointer);
    if (!fields) {
      fields = new RequestHeaders();
      requests.set(pointer, fields);
    }
    return fields;
  };
  const string = (pointer: number) => {
    if (!host.isString(pointer))
      throw new Error("HTTP header names and values must be NSString objects.");
    return host.text(pointer);
  };
  host.method(RequestClass.Mutable, false, "setValue:forHTTPHeaderField:", (self, args) => {
    const value = args(0) ? string(args(0)) : undefined,
      field = string(args(1));
    mutable(self).set(field, value);
  });
  host.method(RequestClass.Mutable, false, "addValue:forHTTPHeaderField:", (self, args) => {
    if (args(0)) mutable(self).add(string(args(1)), string(args(0)));
  });
  host.method(RequestClass.Mutable, false, "setAllHTTPHeaderFields:", (self, args) => {
    const dictionary = args(0);
    if (!dictionary) return;
    if (!host.isDictionary(dictionary))
      throw new Error("HTTP header fields must be an NSDictionary.");
    const entries = host
      .entries(dictionary)
      .map(([key, value]) => [string(key), string(value)] as const);
    for (const [key, value] of entries) mutable(self).set(key, value);
  });
  host.method(RequestClass.Base, false, "valueForHTTPHeaderField:", (self, args) => {
    const value = requests.get(self)?.get(string(args(0)));
    return value === undefined ? 0 : host.string(value);
  });
  host.method(RequestClass.Base, false, "allHTTPHeaderFields", (self) => {
    const fields = requests.get(self);
    return fields ? host.property(fields.all()) : 0;
  });
  return (pointer) => {
    requests.delete(pointer);
  };
}
