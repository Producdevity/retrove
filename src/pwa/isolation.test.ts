import { expect, test } from "vite-plus/test";
import { withIsolation } from "./isolation";

test("isolation headers replace stale values and keep the body and type", async () => {
  const stale = new Response("body", {
    status: 200,
    headers: { "Content-Type": "text/html", "Cross-Origin-Embedder-Policy": "unsafe-none" },
  });
  const response = withIsolation(stale);
  expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe("require-corp");
  expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
  expect(response.headers.get("Content-Type")).toBe("text/html");
  expect(await response.text()).toBe("body");
});
