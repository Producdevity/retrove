import type { InstalledApplication } from "../../domain/application";
import { errorMessage } from "../../domain/validation";
import type { PreparedBackup } from "../../runtime/storage/backup/restore";
import { action, node } from "../../ui/dom";
import { download } from "../../ui/download";
import { formatBytes } from "../../ui/format";
import { exportApplicationSaves, inspectSaveBackup, restoreApplicationSaves } from "../saves";
function backupFilename(app: InstalledApplication): string {
  const name = app.bundleId.replace(/[^a-z0-9._-]/gi, "-");
  const day = new Date().toISOString().split("T")[0];
  return `${name}-${day}.retrove.zip`;
}
export class SaveActions {
  readonly element = node("section", "save-actions");
  private readonly controls = node("fieldset");
  private readonly status = node("p", "save-status");
  private readonly input = node("input");
  private readonly preview = node("div", "save-preview");
  private readonly summary = node("p");
  private readonly controller = new AbortController();
  private backup: PreparedBackup | undefined;
  private busy = false;
  constructor(
    private readonly app: InstalledApplication,
    private readonly refresh: () => Promise<void>,
  ) {
    const heading = node("h3", "", "Progress & settings");
    const help = node("p", "secondary", "Keep a backup or move your progress to another device.");
    this.status.setAttribute("role", "status");
    this.input.type = "file";
    this.input.accept = ".zip";
    this.input.hidden = true;
    this.input.setAttribute("aria-label", "Choose a Retrove save backup");
    const exportButton = node("button", "", "Export progress"),
      restoreButton = node("button", "", "Restore progress");
    exportButton.type = restoreButton.type = "button";
    exportButton.addEventListener(
      "click",
      action(() => this.run(() => this.export()), this.failure),
    );
    restoreButton.addEventListener("click", () => this.input.click());
    this.input.addEventListener(
      "change",
      action(() => this.run(() => this.inspect()), this.failure),
    );
    this.controls.append(exportButton, restoreButton, this.input);
    const confirm = node("button", "danger", "Replace progress"),
      cancel = node("button", "", "Cancel");
    confirm.type = cancel.type = "button";
    confirm.addEventListener(
      "click",
      action(() => this.run(() => this.restore()), this.failure),
    );
    cancel.addEventListener("click", () => this.clearPreview());
    this.preview.append(this.summary, confirm, cancel);
    this.preview.hidden = true;
    this.controls.append(this.preview);
    this.element.append(heading, help, this.controls, this.status);
  }
  private failure = (error: unknown): void => {
    if (!this.controller.signal.aborted) this.status.textContent = errorMessage(error);
  };
  private async run(operation: () => Promise<void>): Promise<void> {
    if (this.busy || this.controller.signal.aborted) return;
    this.busy = true;
    this.controls.disabled = true;
    try {
      await operation();
    } finally {
      this.controls.disabled = false;
      this.busy = false;
    }
  }
  private async export(): Promise<void> {
    this.status.textContent = "Preparing backup…";
    const archive = await exportApplicationSaves(this.app, this.controller.signal);
    this.controller.signal.throwIfAborted();
    download(archive, backupFilename(this.app));
    this.status.textContent = "Backup export started. Keep the ZIP somewhere safe.";
  }
  private async inspect(): Promise<void> {
    const file = this.input.files?.item(0);
    this.input.value = "";
    if (!file) return;
    this.clearPreview();
    this.status.textContent = "Checking backup…";
    this.backup = await inspectSaveBackup(this.app, file, this.controller.signal);
    this.controller.signal.throwIfAborted();
    const { manifest, bytes } = this.backup;
    const date = new Date(manifest.exportedAt).toLocaleString();
    this.summary.textContent = `Replace this app’s current progress and settings with the backup from ${date}? App version ${manifest.app.version} · ${formatBytes(bytes)}. Export your current progress first if you want to keep it.`;
    this.preview.hidden = false;
    this.status.textContent = "Backup verified. Your current progress has not changed.";
  }
  private async restore(): Promise<void> {
    if (!this.backup) return;
    this.status.textContent = "Restoring progress…";
    await restoreApplicationSaves(this.app, this.backup, this.controller.signal);
    this.clearPreview();
    this.status.textContent = "Progress restored. Open the app to continue.";
    await this.refresh();
  }
  private clearPreview(): void {
    this.backup = undefined;
    this.preview.hidden = true;
  }
  close(): void {
    this.controller.abort(new DOMException("App details closed", "AbortError"));
    this.clearPreview();
    this.input.value = "";
  }
}
