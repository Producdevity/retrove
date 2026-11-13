import { expect, test } from "vite-plus/test";
import { withApplicationSession } from "./session-lock";
test("gameplay and save operations cannot overlap for one app", async () => {
  const id = `ios:${crypto.randomUUID()}` as const;
  await withApplicationSession(id, async () => {
    await expect(withApplicationSession(id, () => Promise.resolve("unexpected"))).rejects.toThrow(
      "Close this app",
    );
    expect(await withApplicationSession("ios:another-app", () => Promise.resolve("isolated"))).toBe(
      "isolated",
    );
  });
  expect(await withApplicationSession(id, () => Promise.resolve("released"))).toBe("released");
});
test("failed app operations release their session lease", async () => {
  const id = `ios:${crypto.randomUUID()}` as const;
  await expect(
    withApplicationSession(id, () => Promise.reject(new Error("Failed restore"))),
  ).rejects.toThrow("Failed restore");
  expect(await withApplicationSession(id, () => Promise.resolve(true))).toBe(true);
});
