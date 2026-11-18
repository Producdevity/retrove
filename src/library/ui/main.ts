import { BUILD_ID } from "../../pwa/update-protocol";
import "../../ui/appearance.css";
import "./library.css";
import { initializeAppearance } from "../../ui/appearance";
import type { InstalledApplication } from "../../domain/application";
import { errorMessage } from "../../domain/validation";
import { connectActivity } from "../../diagnostics/activity";
import { libraryJournal } from "../../diagnostics/journal";
import { DiagnosticOperation, failedOperation, observed } from "../../diagnostics/operations";
import { element } from "../../ui/dom";
import { browserLibrary } from "../browser";
import { appDetails } from "./details";
import { Dock } from "./dock";
import { Drawer } from "./drawer";
import { connectImport } from "./import";
import { connectInstall } from "./install";
import { connectNavigation, Page } from "./navigation";
import { connectSettings } from "./settings";
import { TabBar } from "./tab-bar";
import { connectUpdates } from "./updates";

initializeAppearance();
element("build-id", HTMLSpanElement).textContent = `Build ${BUILD_ID}`;
libraryJournal.record(DiagnosticOperation.Session, {
  build: String(import.meta.env.VITE_RETROVE_REVISION),
  browser: navigator.userAgent,
  secure: isSecureContext,
  standalone: matchMedia("(display-mode: standalone)").matches,
});
const error = element("error", HTMLParagraphElement);
const errorLogs = element("error-logs", HTMLButtonElement);
const failure = (cause: unknown): void => {
  libraryJournal.record(DiagnosticOperation.Interface, {}, cause);
  error.textContent = failedOperation(cause, DiagnosticOperation.FileStorage)
    ? "Retrove could not open its storage. Private browsing and in-app browsers block it; open Retrove in Safari."
    : errorMessage(cause);
  errorLogs.hidden = false;
  error.hidden = false;
};
const { library, recover, storage: management } = browserLibrary(failure);
const settingsPage = element(Page.Settings, HTMLElement);
const launch = (app: InstalledApplication): void => {
  dock.release();
  // Replacing keeps no history entry, so a back swipe cannot close the running game.
  location.replace(`/player.html?app=${encodeURIComponent(app.id)}`);
};
const storage = connectSettings(failure, management, () => refresh());
const showStorage = (): void => void observed(DiagnosticOperation.Settings, storage).catch(failure);
const refresh = async (): Promise<void> => {
  await observed(DiagnosticOperation.Maintenance, recover).catch(failure);
  drawer.show(await observed(DiagnosticOperation.Refresh, () => library.list()));
  if (!settingsPage.hidden) await observed(DiagnosticOperation.Settings, storage);
};
const drawer = new Drawer(appDetails(library, management, launch, refresh, failure), launch);

const sidebar = document.querySelector(".sidebar");
const nav = document.querySelector(".tab-bar");
const selection = document.querySelector(".tab-bar .selection");
if (
  !(sidebar instanceof HTMLElement) ||
  !(nav instanceof HTMLElement) ||
  !(selection instanceof HTMLElement)
)
  throw new Error("Missing navigation interface.");
const dock = new Dock({ sidebar, nav });
const navigate = connectNavigation(new TabBar(nav, selection, () => dock.lens), {
  [Page.Activity]: connectActivity(),
  [Page.Settings]: showStorage,
});
errorLogs.addEventListener("click", () => navigate(Page.Activity));
connectInstall(() => {
  navigate(Page.Settings);
  element("install-card", HTMLDivElement).scrollIntoView({ block: "center" });
}, failure);
connectImport(library, refresh, failure, (milliseconds) => dock.wake(milliseconds));
void refresh().catch(failure);

connectUpdates((cause) => libraryJournal.record(DiagnosticOperation.Offline, {}, cause));
