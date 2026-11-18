import { describe, expect, it } from "vite-plus/test";
import {
  EARLIER_REPORTS_KEY,
  LAST_REPORT_KEY,
  UNCLEAN_END,
  archiveLastReport,
  readEarlierReports,
  type ReportStorage,
} from "./report-archive";

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
const report = (state: string, app = "Bioshock") =>
  `Retrove runtime diagnostics\nInput: ${app}\nState: ${state} (+12.5s)\n`;

describe("report archive", () => {
  it("keeps a finished report as it was", () => {
    const storage = memory();
    storage.setItem(LAST_REPORT_KEY, report("failed"));
    archiveLastReport(storage);
    expect(readEarlierReports(storage)).toEqual([report("failed")]);
    expect(storage.getItem(LAST_REPORT_KEY)).toBeNull();
  });
  it("labels a report whose session never ended", () => {
    const storage = memory();
    storage.setItem(LAST_REPORT_KEY, report("running"));
    archiveLastReport(storage);
    expect(readEarlierReports(storage)[0]?.startsWith(UNCLEAN_END)).toBe(true);
  });
  it("keeps the newest five", () => {
    const storage = memory();
    for (let index = 0; index < 7; index++) {
      storage.setItem(LAST_REPORT_KEY, report("stopped", `App ${index}`));
      archiveLastReport(storage);
    }
    const kept = readEarlierReports(storage);
    expect(kept).toHaveLength(5);
    expect(kept[0]).toContain("App 6");
  });
  it("drops the oldest reports when storage is full", () => {
    const storage = memory();
    storage.setItem(EARLIER_REPORTS_KEY, JSON.stringify([report("stopped", "Old")]));
    storage.setItem = (key, value) => {
      if (key === EARLIER_REPORTS_KEY && value.includes("Old")) throw new Error("quota");
      storage.map.set(key, value);
    };
    storage.setItem(LAST_REPORT_KEY, report("failed", "New"));
    archiveLastReport(storage);
    expect(readEarlierReports(storage)).toEqual([report("failed", "New")]);
  });
});
