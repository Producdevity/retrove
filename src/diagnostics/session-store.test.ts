import { describe, expect, it } from "vite-plus/test";
import {
  LAST_REPORT_KEY,
  UNCLEAN_END,
  archiveLastReport,
  clearSessions,
  deleteSession,
  readSessions,
  type ReportStorage,
} from "./session-store";

function memory(): ReportStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}
let run = 0;
function report(state: string, app = "Bioshock"): string {
  run += 1;
  return `Retrove runtime diagnostics\nRun: run-${run}\nInput: ${app}\nState: ${state} (+12.5s)\n`;
}
function finish(storage: ReportStorage, text: string): void {
  storage.setItem(LAST_REPORT_KEY, text);
  archiveLastReport(storage);
}

describe("session store", () => {
  it("lists the current session first, then archived ones newest first", () => {
    const storage = memory();
    finish(storage, report("failed", "Cut the Rope"));
    storage.setItem(LAST_REPORT_KEY, report("running"));
    const sessions = readSessions(storage);
    expect(sessions.map((session) => [session.app, session.current])).toEqual([
      ["Bioshock", true],
      ["Cut the Rope", false],
    ]);
  });
  it("labels a report whose session never ended", () => {
    const storage = memory();
    finish(storage, report("running"));
    const [session] = readSessions(storage);
    expect(session?.text.startsWith(UNCLEAN_END)).toBe(true);
    expect(session?.app).toBe("Bioshock");
  });
  it("keeps five per app and twenty overall", () => {
    const storage = memory();
    for (let index = 0; index < 8; index++) finish(storage, report("stopped", "Bioshock"));
    for (let index = 0; index < 30; index++) finish(storage, report("stopped", `App ${index}`));
    const sessions = readSessions(storage);
    expect(sessions).toHaveLength(20);
    expect(sessions.filter((session) => session.app === "Bioshock")).toHaveLength(0);
    const fresh = memory();
    for (let index = 0; index < 8; index++) finish(fresh, report("stopped", "Bioshock"));
    expect(readSessions(fresh)).toHaveLength(5);
  });
  it("migrates the earlier-reports list", () => {
    const storage = memory();
    storage.setItem("retrove.earlier-reports", JSON.stringify([report("failed", "Zippo")]));
    expect(readSessions(storage).map((session) => session.app)).toEqual(["Zippo"]);
    expect(storage.getItem("retrove.earlier-reports")).toBeNull();
  });
  it("deletes one session or all of them", () => {
    const storage = memory();
    finish(storage, report("failed", "A"));
    finish(storage, report("failed", "B"));
    const [newest] = readSessions(storage);
    deleteSession(storage, newest?.id ?? "");
    expect(readSessions(storage).map((session) => session.app)).toEqual(["A"]);
    clearSessions(storage);
    expect(readSessions(storage)).toEqual([]);
  });
});
