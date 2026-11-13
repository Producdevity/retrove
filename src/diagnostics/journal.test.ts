import { expect, test } from "vite-plus/test";
import { DiagnosticJournal, describeError } from "./journal";
import { DiagnosticOperation, OperationError, failedOperation, observed } from "./operations";

test("storage errors retain the failing operation and original browser error", async () => {
  const original = new DOMException(
    "The operation failed for an unknown transient reason (e.g. out of memory).",
    "UnknownError",
  );
  let failure: unknown;
  try {
    await observed(DiagnosticOperation.Maintenance, () =>
      observed(DiagnosticOperation.FileStorage, () => Promise.reject(original)),
    );
  } catch (error) {
    failure = error;
  }
  expect(failedOperation(failure, DiagnosticOperation.FileStorage)).toBe(true);
  expect(describeError(failure)).toContain("UnknownError");
  expect(describeError(failure)).toContain("open-file-storage");
  expect(describeError(failure)).toContain(original.message);
});

test("logs remain bounded and available when browser storage rejects reads and writes", () => {
  const journal = new DiagnosticJournal({
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  });
  for (let index = 0; index < 200; index++)
    journal.record(DiagnosticOperation.Import, { index }, new Error("failure"));
  expect(journal.text().split("\n")).toHaveLength(100);
  expect(journal.text()).toContain('"index":199');
  expect(journal.text()).not.toContain('"index":0,');
  journal.record(DiagnosticOperation.Interface, {}, new Error("x".repeat(100_000)));
  expect(journal.text().length).toBeLessThan(100 * 4097);
});

test("journal survives reload and cyclic error causes cannot recurse indefinitely", () => {
  let stored = "";
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  const error = new OperationError(DiagnosticOperation.Database, new Error("blocked"));
  error.cause = error;
  const journal = new DiagnosticJournal(storage);
  journal.record(DiagnosticOperation.Interface, {}, error);
  expect(new DiagnosticJournal(storage).text()).toEqual(journal.text());
  expect(failedOperation(error, DiagnosticOperation.FileStorage)).toBe(false);
});
