import { expect, test } from "vite-plus/test";
import { groupRepeats, parseEntry, parseSession } from "./log-view";

test("a journal line becomes a titled entry with its fields", () => {
  const entry = parseEntry(
    JSON.stringify({
      time: "2026-11-17T21:00:00.000Z",
      operation: "import-app",
      state: "started",
      bytes: 12,
    }),
  );
  expect(entry).toEqual({
    time: new Date("2026-11-17T21:00:00.000Z"),
    title: "Import",
    detail: "state: started · bytes: 12",
    problem: false,
  });
});

test("an entry with an error shows the first line of the error as a problem", () => {
  const entry = parseEntry(
    JSON.stringify({ operation: "read-ipa-package", error: "TypeError: bad\n at x" }),
  );
  expect(entry.problem).toBe(true);
  expect(entry.detail).toBe("TypeError: bad");
  expect(entry.title).toBe("Read IPA");
});

test("a line that is not JSON is kept as text", () => {
  expect(parseEntry("plain text")).toEqual({
    time: undefined,
    title: "Event",
    detail: "plain text",
    problem: false,
  });
});

test("the runtime report header summarizes the last session", () => {
  const report = [
    "Retrove runtime diagnostics",
    "Run: 1-a",
    "Input: DoodleJump",
    "Started: 2026-11-17T21:03:19.874Z",
    "Last checkpoint: 2026-11-17T21:03:44.945Z",
    "State: failed (+25.070s)",
    "First error: [guest] Unimplemented class",
  ].join("\n");
  expect(parseSession(report)).toEqual({
    app: "DoodleJump",
    state: "failed",
    started: new Date("2026-11-17T21:03:19.874Z"),
    seconds: 25.07,
    firstError: "[guest] Unimplemented class",
  });
  expect(parseSession(null)).toBeUndefined();
});

test("identical entries in a row collapse into one with a count", () => {
  const opened = { time: undefined, title: "Library opened", detail: "build: a", problem: false };
  const failed = { time: undefined, title: "Import", detail: "bad", problem: true };
  expect(groupRepeats([opened, opened, failed, opened])).toEqual([
    { ...opened, count: 2 },
    { ...failed, count: 1 },
    { ...opened, count: 1 },
  ]);
});
