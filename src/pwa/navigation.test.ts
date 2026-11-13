import { expect, test } from "vite-plus/test";
import { navigationResponse, shellDocument } from "./navigation";
test("cached redirected HTML can satisfy a navigation with manual redirect mode", async () => {
  const cached = new Response("<!doctype html><title>Retrove</title>", {
    headers: { "Content-Type": "text/html", "X-Content-Type-Options": "nosniff" },
  });
  Object.defineProperty(cached, "redirected", { value: true });
  const response = navigationResponse(cached);
  expect(response.redirected).toBe(false);
  expect(response.status).toBe(cached.status);
  expect([...response.headers]).toEqual([...cached.headers]);
  expect(await response.text()).toBe("<!doctype html><title>Retrove</title>");
});
test("canonical hosting URLs resolve to the same cached library and player documents", () => {
  expect(shellDocument("/")).toBe("/index.html");
  expect(shellDocument("/index")).toBe("/index.html");
  expect(shellDocument("/player")).toBe("/player.html");
  expect(shellDocument("/player/")).toBe("/player.html");
  expect(shellDocument("/player.html")).toBe("/player.html");
  expect(shellDocument("/assets/player.js")).toBe("/assets/player.js");
  const response = new Response("direct");
  expect(navigationResponse(response)).toBe(response);
});
