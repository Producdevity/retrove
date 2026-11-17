import { confirmAction } from "../../ui/confirmation";
import type { StorageManagement } from "../../storage/management/service";
import type { InstalledApplication } from "../../domain/application";
import type { ApplicationLibrary } from "../service";
import { action, element, node } from "../../ui/dom";
import { formatBytes } from "../../ui/format";
import { morph } from "../../ui/morph";
import { AppIcons } from "./app-list";
import { SaveActions } from "./save-actions";
import "./save-actions.css";

export function appDetails(
  library: ApplicationLibrary,
  manager: StorageManagement,
  launch: (app: InstalledApplication) => void,
  refresh: () => Promise<void>,
  failure: (error: unknown) => void,
): (app: InstalledApplication, origin: HTMLElement) => void {
  const dialog = element("app-details", HTMLDialogElement);
  const contents = element("details-content", HTMLDivElement);
  const remove = element("remove", HTMLButtonElement);
  const erase = element("delete-app-data", HTMLButtonElement);
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
  connectDelete(
    erase,
    () => selected,
    manager,
    dialog,
    refresh,
    failure,
    (busy) => {
      open.disabled = remove.disabled = erase.disabled = busy;
    },
  );
  dialog.addEventListener("close", () => {
    icons.clear();
    saves?.close();
    saves = undefined;
    selected = undefined;
    open.disabled = remove.disabled = erase.disabled = false;
  });
  return (app, origin) => {
    if (dialog.open) return;
    selected = app;
    element("remove-status", HTMLParagraphElement).textContent = "";
    saves?.close();
    saves = new SaveActions(app, refresh, (busy) => {
      open.disabled = remove.disabled = erase.disabled = busy;
    });
    contents.replaceChildren(
      icons.create(app),
      node("h2", "", app.name),
      node("p", "", app.bundleId),
      node("p", "", `Version ${app.version} · ${formatBytes(app.size)}`),
    );
    contents.append(saves.element);
    dialog.showModal();
    void morph(dialog, origin, true);
  };
}

function connectDelete(
  erase: HTMLButtonElement,
  selected: () => InstalledApplication | undefined,
  manager: StorageManagement,
  dialog: HTMLDialogElement,
  refresh: () => Promise<void>,
  failure: (error: unknown) => void,
  busy: (value: boolean) => void,
): void {
  erase.addEventListener(
    "click",
    action(async () => {
      const app = selected();
      if (!app) return;
      if (
        !(await confirmAction({
          title: `Delete ${app.name}?`,
          description: "Its IPA, saves and settings are deleted. This cannot be undone.",
          action: "Delete app & data",
        }))
      )
        return;
      busy(true);
      try {
        await manager.remove(app.id, true, (message) => {
          element("remove-status", HTMLParagraphElement).textContent = message;
        });
        dialog.close();
        await refresh();
      } finally {
        busy(false);
      }
    }, failure),
  );
}
