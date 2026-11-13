import { element } from "../ui/dom";
import { download } from "../ui/download";
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
  const report = element("report", HTMLPreElement);
  const status = element("report-status", HTMLParagraphElement);
  const exportButton = element("export-log", HTMLButtonElement);
  const refresh = (): void => {
    const text = readLastReport();
    report.textContent = text ?? "";
    status.textContent = text ? "Last runtime report. Kept on this device." : "No sessions yet.";
    exportButton.disabled = !text;
  };
  exportButton.addEventListener("click", () => {
    const text = readLastReport();
    if (text) download(new Blob([text], { type: "text/plain" }), "retrove-report.txt");
  });
  return refresh;
}
