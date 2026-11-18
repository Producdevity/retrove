import { describe, expect, it } from "vite-plus/test";
import { HttpMessage } from "./http-message";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("HttpMessage", () => {
  it("serializes a request with headers and body", () => {
    const message = HttpMessage.request("POST", "http://example.test/a", "HTTP/1.1");
    message.setHeader("Content-Type", "text/plain");
    message.setHeader("content-type", "application/json");
    message.body = new TextEncoder().encode("{}");
    expect(text(message.serialize())).toBe(
      "POST http://example.test/a HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{}",
    );
    expect(message.header("CONTENT-TYPE")).toBe("application/json");
  });
  it("parses a response delivered in pieces", () => {
    const message = new HttpMessage(false);
    expect(message.headerComplete).toBe(false);
    expect(message.append(new TextEncoder().encode("HTTP/1.0 404 Not Found\r\nX-A: 1"))).toBe(true);
    expect(message.headerComplete).toBe(false);
    expect(message.append(new TextEncoder().encode("\r\n\r\nbody"))).toBe(true);
    expect(message.headerComplete).toBe(true);
    expect(message.status).toBe(404);
    expect(message.statusLine()).toBe("HTTP/1.0 404 Not Found");
    expect(message.allHeaders()).toEqual({ "X-A": "1" });
    expect(text(message.body)).toBe("body");
  });
  it("rejects a malformed start line", () => {
    expect(new HttpMessage(false).append(new TextEncoder().encode("nonsense\r\n\r\n"))).toBe(false);
  });
});
