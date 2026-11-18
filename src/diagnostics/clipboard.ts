/** How long a successful copy stays confirmed. */
const CONFIRMATION_MS = 2500;

export function connectCopy(
  button: HTMLButtonElement,
  report: HTMLTextAreaElement,
  status: HTMLElement,
  refresh: () => void,
): void {
  let clearing = 0;
  button.addEventListener("click", () => {
    clearTimeout(clearing);
    status.textContent = "";
    refresh();
    const unavailable = (): void => {
      const disclosure = report.closest("details");
      if (disclosure) disclosure.open = true;
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
      clearing = window.setTimeout(() => {
        status.textContent = "";
      }, CONFIRMATION_MS);
    }, unavailable);
  });
}
