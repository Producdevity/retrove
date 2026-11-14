import { BUILD_ID } from "../../pwa/update-protocol";
import "../../ui/appearance.css";
import "./library.css";
import { initializeAppearance } from "../../ui/appearance";
import { registerOfflineShell } from "../../pwa/register";
import type { InstalledApplication } from "../../domain/application";
import { errorMessage } from "../../domain/validation";
import { connectActivity } from "../../diagnostics/activity";
import { element } from "../../ui/dom";
import { browserLibrary } from "../browser";
import { AppIcons, appRow } from "./app-list";
import { appDetails } from "./details";
import { connectImport } from "./import";
import { connectNavigation } from "./navigation";
import { connectSettings } from "./settings";

import { libraryJournal } from "../../diagnostics/journal";
import { DiagnosticOperation, failedOperation, observed } from "../../diagnostics/operations";
initializeAppearance();
element("build-id", HTMLParagraphElement).textContent = `Build ${BUILD_ID}`;
libraryJournal.record(DiagnosticOperation.Session, {
  build: String(import.meta.env.VITE_RETROVE_REVISION),
  browser: navigator.userAgent,
  secure: isSecureContext,
  standalone: matchMedia("(display-mode: standalone)").matches,
});
const error = element("error", HTMLParagraphElement);
const failure = (cause: unknown): void => {
  libraryJournal.record(DiagnosticOperation.Interface, {}, cause);
  error.textContent = failedOperation(cause, DiagnosticOperation.FileStorage)
    ? "Local file storage could not be opened. Try a regular Safari tab if you opened Retrove in private browsing or inside another app. Debug logs contain the exact failure."
    : errorMessage(cause);
  element("error-logs", HTMLButtonElement).hidden = false;
  error.hidden = false;
};
const { library, recover, storage: management } = browserLibrary(failure);
const list = element("apps", HTMLDivElement);
const search = element("search", HTMLInputElement);
const count = element("library-count", HTMLParagraphElement);
const empty = element("empty", HTMLDivElement);
const noResults = element("no-results", HTMLParagraphElement);
const icons = new AppIcons();
let apps: InstalledApplication[] = [];
const launch = (app: InstalledApplication): void => {
  location.href = `/player.html?app=${encodeURIComponent(app.id)}`;
};
const storage = connectSettings(failure, management, () => refresh());
const refresh = async (): Promise<void> => {
  await observed(DiagnosticOperation.Maintenance, recover).catch(failure);
  apps = (await observed(DiagnosticOperation.Refresh, () => library.list())).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  render();
  await observed(DiagnosticOperation.Settings, storage);
};
const details = appDetails(library, management, launch, refresh, failure);
function render(): void {
  icons.clear();
  const query = search.value.toLowerCase();
  const visible = apps.filter((app) => app.name.toLowerCase().includes(query));
  count.textContent = apps.length
    ? `${apps.length} ${apps.length === 1 ? "app" : "apps"} on this device`
    : "Your personal app library";
  empty.hidden = apps.length > 0;
  noResults.hidden = !apps.length || visible.length > 0;
  list.replaceChildren(...visible.map((app) => appRow(app, icons, details, launch)));
}
search.addEventListener("input", render);
connectNavigation(connectActivity());
connectImport(library, refresh, failure);
void refresh().catch(failure);

void observed(DiagnosticOperation.Offline, () =>
  registerOfflineShell((message) => {
    element("install-help", HTMLParagraphElement).textContent = message;
  }),
).catch(failure);
