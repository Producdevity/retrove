import { element } from "../ui/dom";
import { download } from "../ui/download";
import { libraryJournal } from "./journal";
import { connectCopy } from "./clipboard";
export const LAST_REPORT_KEY = "retrove.last-report";
export function readLastReport(): string | null {
  try {
    return localStorage.getItem(LAST_REPORT_KEY);
  } catch {
    return null;
  }
}
export function saveLastReport(value: string): void {
  localStorage.setItem(LAST_REPORT_KEY, value);
}
export function connectActivity(): () => void {
  const report = element("report", HTMLTextAreaElement);
  const status = element("report-status", HTMLParagraphElement);
  const exportButton = element("export-log", HTMLButtonElement);
  const refresh = (): void => {
    report.value = [
      "Retrove debug logs",
      `Build: ${import.meta.env.VITE_RETROVE_REVISION}`,
      libraryJournal.text(),
      readLastReport(),
    ]
      .filter(Boolean)
      .join("\n\n");
    status.textContent = "";
  };
  connectCopy(element("copy-log", HTMLButtonElement), report, status, refresh);
  exportButton.addEventListener("click", () => {
    refresh();
    download(new Blob([report.value], { type: "text/plain" }), "retrove-report.txt");
  });
  return refresh;
}
