import type { InstalledApplication } from "../../domain/application";
import { element } from "../../ui/dom";
import { AppIcons, appTile } from "./app-list";

/** The grid of installed apps, filtered by the search field. */
export class Drawer {
  private readonly list = element("apps", HTMLDivElement);
  private readonly count = element("library-count", HTMLParagraphElement);
  private readonly empty = element("empty", HTMLDivElement);
  private readonly noResults = element("no-results", HTMLParagraphElement);
  private readonly search = element("search", HTMLInputElement);
  private readonly icons = new AppIcons();
  private apps: readonly InstalledApplication[] = [];
  /** Undefined until the first render, so the initial apps do not animate in. */
  private known: ReadonlySet<string> | undefined;
  constructor(
    private readonly details: (app: InstalledApplication, origin: HTMLElement) => void,
    private readonly launch: (app: InstalledApplication) => void,
  ) {
    this.list.setAttribute("role", "list");
    this.list.setAttribute("aria-label", "Apps");
    this.search.addEventListener("input", () => this.render());
  }
  show(apps: readonly InstalledApplication[]): void {
    this.apps = [...apps].sort((left, right) => left.name.localeCompare(right.name));
    this.render();
  }
  private render(): void {
    this.icons.clear();
    const query = this.search.value.trim().toLowerCase();
    const visible = this.apps.filter((app) => app.name.toLowerCase().includes(query));
    const total = this.apps.length;
    this.count.textContent = total ? `${total} ${total === 1 ? "app" : "apps"}` : "";
    this.count.hidden = !total || Boolean(query);
    this.empty.hidden = total > 0;
    this.search.closest("label")?.toggleAttribute("hidden", total === 0);
    this.noResults.hidden = !total || visible.length > 0;
    const known = this.known;
    this.list.replaceChildren(
      ...visible.map((app) => {
        const tile = appTile(app, this.icons, this.details, this.launch);
        if (known && !known.has(app.id)) tile.classList.add("entering");
        return tile;
      }),
    );
    this.known = new Set(this.apps.map((app) => app.id));
  }
}
