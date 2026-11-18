import { describe, expect, it } from "vite-plus/test";
import { cookieMatches } from "./http-cookies";

describe("cookieMatches", () => {
  it("matches host-only cookies exactly", () => {
    expect(cookieMatches("example.test", "example.test")).toBe(true);
    expect(cookieMatches("example.test", "www.example.test")).toBe(false);
  });
  it("matches domain cookies on the domain and its subdomains", () => {
    expect(cookieMatches(".Example.test", "example.test")).toBe(true);
    expect(cookieMatches(".example.test", "a.example.test")).toBe(true);
    expect(cookieMatches(".example.test", "badexample.test")).toBe(false);
  });
});
