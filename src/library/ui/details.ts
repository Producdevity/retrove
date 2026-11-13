import type { InstalledApplication } from "../../domain/application";
import type { ApplicationLibrary } from "../service";
import { action, element, node } from "../../ui/dom";
import { formatBytes } from "../../ui/format";
import { AppIcons } from "./app-list";
import { SaveActions } from "./save-actions";
import "./save-actions.css";

export function appDetails(
  library: ApplicationLibrary,
  launch: (app: InstalledApplication) => void,
  refresh: () => Promise<void>,
  failure: (error: unknown) => void,
): (app: InstalledApplication) => void {
  const dialog = element("app-details", HTMLDialogElement);
  const contents = element("details-content", HTMLDivElement);
  const remove = element("remove", HTMLButtonElement);
  const open = element("details-launch", HTMLButtonElement);
  const icons = new AppIcons();
  let selected: InstalledApplication | undefined;
  let saves: SaveActions | undefined;
  open.addEventListener("click", () => {
    if (selected) launch(selected);
  });
  remove.addEventListener(
    "click",
    action(async () => {
      if (!selected) return;
      remove.disabled = true;
      try {
        await library.remove(selected.id);
        dialog.close();
        await refresh();
      } finally {
        remove.disabled = false;
      }
    }, failure),
  );
  dialog.addEventListener("close", () => {
    icons.clear();
    saves?.close();
    saves = undefined;
    selected = undefined;
  });
  return (app) => {
    selected = app;
    saves?.close();
    saves = new SaveActions(app, refresh);
    contents.replaceChildren(
      icons.create(app),
      node("h2", "", app.name),
      node("p", "", app.bundleId),
      node("p", "", `Version ${app.version} • ${formatBytes(app.size)}`),
    );
    contents.append(saves.element);
    dialog.showModal();
  };
}
