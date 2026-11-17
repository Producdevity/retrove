import type { InstalledApplication } from "../../domain/application";
import { node } from "../../ui/dom";
import { Icon, icon } from "../../ui/icons";
import { onLongPress } from "../../ui/long-press";

export class AppIcons {
  private readonly urls = new Set<string>();
  create(app: InstalledApplication): HTMLElement {
    if (!app.icon) return node("div", "app-icon app-monogram", app.name.slice(0, 1));
    const url = URL.createObjectURL(app.icon);
    this.urls.add(url);
    const image = node("img", "app-icon");
    image.src = url;
    image.alt = "";
    image.draggable = false;
    return image;
  }
  clear(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/**
 * An app as it sits in the drawer: tapping the icon opens it and holding it shows its
 * details. The details button is for keyboards and screen readers, and shows on focus.
 */
export function appTile(
  app: InstalledApplication,
  icons: AppIcons,
  details: (app: InstalledApplication, origin: HTMLElement) => void,
  launch: (app: InstalledApplication) => void,
): HTMLElement {
  const tile = node("div", "tile");
  tile.setAttribute("role", "listitem");
  const open = node("button", "tile-open");
  open.setAttribute("aria-label", `Open ${app.name}`);
  const image = icons.create(app);
  open.append(image, node("span", "tile-name", app.name));
  open.addEventListener("click", () => launch(app));
  onLongPress(open, () => details(app, image));
  const more = node("button", "tile-details");
  more.append(icon(Icon.More));
  more.setAttribute("aria-label", `Details for ${app.name}`);
  more.addEventListener("click", () => details(app, image));
  tile.append(open, more);
  return tile;
}
