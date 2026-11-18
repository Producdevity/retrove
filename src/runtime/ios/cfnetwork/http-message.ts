const CRLF = "\r\n";
const HEADER_END = "\r\n\r\n";
const SEPARATOR = ": ";
const STATUS_PATTERN = /^(HTTP\/\d\.\d)\s+(\d{3})(?:\s+(.*))?$/;
const REQUEST_PATTERN = /^(\S+)\s+(\S+)\s+(HTTP\/\d\.\d)$/;
const decoder = new TextDecoder("latin1");
const encoder = new TextEncoder();

/** A CFHTTPMessage: header names keep their first spelling and match case-insensitively. */
export class HttpMessage {
  readonly headers = new Map<string, { name: string; value: string }>();
  body: Uint8Array = new Uint8Array();
  headerComplete: boolean;
  private pending = "";
  constructor(
    readonly request: boolean,
    public version = "HTTP/1.1",
    public method = "",
    public url = "",
    public status = 0,
    public reason = "",
  ) {
    this.headerComplete = Boolean(method || status);
  }
  static request(method: string, url: string, version: string): HttpMessage {
    return new HttpMessage(true, version, method, url);
  }
  static response(status: number, reason: string, version: string): HttpMessage {
    return new HttpMessage(false, version, "", "", status, reason);
  }
  setHeader(name: string, value: string | undefined): void {
    const key = name.toLowerCase();
    if (value === undefined) this.headers.delete(key);
    else this.headers.set(key, { name: this.headers.get(key)?.name ?? name, value });
  }
  header(name: string): string | undefined {
    return this.headers.get(name.toLowerCase())?.value;
  }
  allHeaders(): Record<string, string> {
    return Object.fromEntries([...this.headers.values()].map(({ name, value }) => [name, value]));
  }
  statusLine(): string {
    return `${this.version} ${this.status}${this.reason ? ` ${this.reason}` : ""}`;
  }
  serialize(): Uint8Array {
    const first = this.request ? `${this.method} ${this.url} ${this.version}` : this.statusLine(),
      lines = [
        first,
        ...[...this.headers.values()].map(({ name, value }) => name + SEPARATOR + value),
      ],
      head = encoder.encode(lines.join(CRLF) + HEADER_END),
      bytes = new Uint8Array(head.length + this.body.length);
    bytes.set(head);
    bytes.set(this.body, head.length);
    return bytes;
  }
  /** Feeds received bytes; returns false when the start line or a header is malformed. */
  append(bytes: Uint8Array): boolean {
    if (this.headerComplete) {
      const body = new Uint8Array(this.body.length + bytes.length);
      body.set(this.body);
      body.set(bytes, this.body.length);
      this.body = body;
      return true;
    }
    this.pending += decoder.decode(bytes);
    const end = this.pending.indexOf(HEADER_END);
    if (end < 0) return true;
    const [first = "", ...lines] = this.pending.slice(0, end).split(CRLF),
      rest = this.pending.slice(end + HEADER_END.length);
    this.pending = "";
    if (!this.start(first)) return false;
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon <= 0) return false;
      this.setHeader(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
    this.headerComplete = true;
    return this.append(Uint8Array.from(rest, (character) => character.charCodeAt(0)));
  }
  private start(line: string): boolean {
    const match = (this.request ? REQUEST_PATTERN : STATUS_PATTERN).exec(line);
    if (!match) return false;
    const [, first = "", second = "", third = ""] = match;
    if (this.request) {
      this.method = first;
      this.url = second;
      this.version = third;
    } else {
      this.version = first;
      this.status = Number(second);
      this.reason = third;
    }
    return true;
  }
}
