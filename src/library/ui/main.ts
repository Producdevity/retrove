import "./library.css";
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

const error = element("error", HTMLParagraphElement);
const failure = (cause: unknown): void => {
  error.textContent = errorMessage(cause);
  error.hidden = false;
};
const library = browserLibrary(failure);
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
const storage = connectSettings(failure);
const refresh = async (): Promise<void> => {
  apps = (await library.list()).sort((left, right) => left.name.localeCompare(right.name));
  render();
  await storage();
};
const details = appDetails(library, launch, refresh, failure);
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

void registerOfflineShell((message) => {
  element("install-help", HTMLParagraphElement).textContent = message;
}).catch(failure);
