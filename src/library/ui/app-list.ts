import type { InstalledApplication } from "../../domain/application";
import { node } from "../../ui/dom";
import { formatBytes } from "../../ui/format";

export class AppIcons {
  private readonly urls = new Set<string>();
  create(app: InstalledApplication): HTMLElement {
    if (!app.icon) return node("div", "app-icon app-monogram", app.name.slice(0, 1));
    const url = URL.createObjectURL(app.icon);
    this.urls.add(url);
    const image = node("img", "app-icon");
    image.src = url;
    image.alt = "";
    return image;
  }
  clear(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export function appRow(
  app: InstalledApplication,
  icons: AppIcons,
  details: (app: InstalledApplication) => void,
  launch: (app: InstalledApplication) => void,
): HTMLElement {
  const row = node("article", "app-row");
  const body = node("div", "app-main");
  const title = node("button", "app-name", app.name);
  title.addEventListener("click", () => details(app));
  const metadata = node("p", "app-meta");
  metadata.append(node("span", "", app.version), node("span", "", formatBytes(app.size)));
  body.append(title, metadata);
  const open = node("button", "launch", "Open");
  open.setAttribute("aria-label", `Open ${app.name}`);
  open.addEventListener("click", () => launch(app));
  const more = node("button", "more", "•••");
  more.setAttribute("aria-label", `Details for ${app.name}`);
  more.addEventListener("click", () => details(app));
  row.append(icons.create(app), body, open, more);
  return row;
}
