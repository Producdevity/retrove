export function connectCopy(
  button: HTMLButtonElement,
  report: HTMLTextAreaElement,
  status: HTMLElement,
  refresh: () => void,
): void {
  button.addEventListener("click", () => {
    refresh();
    const unavailable = (): void => {
      report.focus();
      report.select();
      report.setSelectionRange(0, report.value.length);
      status.textContent =
        "Clipboard access was blocked. Logs are selected; use Copy, or download them.";
    };
    if (!navigator.clipboard) {
      unavailable();
      return;
    }
    void navigator.clipboard.writeText(report.value).then(() => {
      status.textContent = "Logs copied to clipboard.";
    }, unavailable);
  });
}
