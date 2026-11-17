import { action, element, node } from "../../../ui/dom";
import { confirmAction } from "../../../ui/confirmation";
import { formatBytes } from "../../../ui/format";
import type { StorageInventory, StorageManagement } from "../../../storage/management/service";
import type { SavedAppData } from "../../../storage/management/saved-data";
export function connectStorageManagement(
  manager: StorageManagement,
  changed: () => Promise<void>,
  failure: (error: unknown) => void,
): () => Promise<void> {
  const panel = element("manage-storage", HTMLDetailsElement),
    list = element("stored-apps", HTMLDivElement),
    unused = element("unused-storage", HTMLParagraphElement),
    translated = element("translation-storage", HTMLParagraphElement),
    status = element("storage-status", HTMLParagraphElement);
  const clean = element("clean-unused", HTMLButtonElement),
    clear = element("clear-apps", HTMLButtonElement),
    forget = element("clear-translations", HTMLButtonElement);
  let busy = false,
    unusedCount = 0,
    translatedCount = 0;
  const execute = async (operation: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    panel.classList.add("busy");
    clean.disabled = clear.disabled = forget.disabled = true;
    try {
      await operation();
      await changed();
    } catch (error) {
      await refresh().catch(failure);
      throw error;
    } finally {
      busy = false;
      panel.classList.remove("busy");
      clear.disabled = false;
      clean.disabled = !unusedCount;
      forget.disabled = !translatedCount;
    }
  };
  const refresh = async () => {
    const inventory = await manager.snapshot();
    render(
      manager,
      inventory,
      list,
      (title, description, operation) => button(title, description, operation, execute, failure),
      (message) => {
        status.textContent = message;
      },
    );
    unusedCount = inventory.unused.length;
    const bytes = inventory.unused.reduce((sum, value) => sum + value.bytes, 0);
    unused.textContent = inventory.unused.length
      ? `${formatBytes(bytes)} in ${inventory.unused.length} unfinished ${inventory.unused.length === 1 ? "import" : "imports"}.`
      : "No unfinished imports.";
    clean.disabled = busy || !inventory.unused.length;
    const summary = await manager.translationSummary();
    translatedCount = summary.modules + summary.apps;
    translated.textContent = translatedCount
      ? `Translated code for ${summary.apps} ${summary.apps === 1 ? "app" : "apps"} (${summary.modules} ${summary.modules === 1 ? "module" : "modules"}). Retrove rebuilds it the next time an app runs.`
      : "No translated code stored.";
    forget.disabled = busy || !translatedCount;
  };
  connectCleanupButtons(manager, clean, clear, status, execute, failure);
  connectTranslationButton(manager, forget, status, execute, failure);
  panel.addEventListener(
    "toggle",
    action(async () => {
      if (panel.open) await refresh();
    }, failure),
  );
  return refresh;
}
function connectCleanupButtons(
  manager: StorageManagement,
  clean: HTMLButtonElement,
  clear: HTMLButtonElement,
  status: HTMLParagraphElement,
  execute: (operation: () => Promise<void>) => Promise<void>,
  failure: (error: unknown) => void,
): void {
  const deleting = (message: string) => {
    status.textContent = message;
  };
  clean.addEventListener(
    "click",
    action(async () => {
      if (
        !(await confirmAction({
          title: "Remove unfinished imports?",
          description:
            "Delete archives that are not in your library. Your installed apps and saves are kept.",
          action: "Remove imports",
        }))
      )
        return;
      await execute(async () => {
        const count = await manager.cleanUnused();
        status.textContent = `Removed ${count} unfinished ${count === 1 ? "import" : "imports"}.`;
      });
    }, failure),
  );
  clear.addEventListener(
    "click",
    action(async () => {
      if (
        !(await confirmAction({
          title: "Delete all apps & saves?",
          description:
            "This removes every imported IPA, unfinished import, save, app setting and translated code from Retrove on this device. This cannot be undone.",
          action: "Delete all",
        }))
      )
        return;
      await execute(async () => {
        await manager.clear(deleting);
        status.textContent = "All apps and saved data removed.";
      });
    }, failure),
  );
}
function connectTranslationButton(
  manager: StorageManagement,
  forget: HTMLButtonElement,
  status: HTMLParagraphElement,
  execute: (operation: () => Promise<void>) => Promise<void>,
  failure: (error: unknown) => void,
): void {
  forget.addEventListener(
    "click",
    action(async () => {
      if (
        !(await confirmAction({
          title: "Clear translated code?",
          description:
            "Delete the ARM code Retrove translated for faster starts. Apps and saves are kept. The next launch of each app is slower while it translates again.",
          action: "Clear",
        }))
      )
        return;
      await execute(async () => {
        await manager.clearTranslations();
        status.textContent = "Translated code cleared.";
      });
    }, failure),
  );
}
type RowAction = (
  label: string,
  description: string,
  operation: () => Promise<void>,
) => HTMLButtonElement;
function render(
  manager: StorageManagement,
  inventory: StorageInventory,
  list: HTMLDivElement,
  button: RowAction,
  blocked: (message: string) => void,
): void {
  const apps = inventory.apps.map((app) => {
    const row = node("div", "storage-app"),
      info = node("div");
    info.append(node("strong", "", app.name), node("span", "secondary", formatBytes(app.size)));
    row.append(
      info,
      button(
        `Delete ${app.name}`,
        `Delete ${app.name}, its IPA, saves and settings? This cannot be undone.`,
        () => manager.remove(app.id, true, blocked),
      ),
    );
    return row;
  });
  const installed = new Set(inventory.apps.map((app) => app.bundleId));
  const saved = inventory.saved
    .filter((item) => !installed.has(item.namespace))
    .map((item) => savedRow(manager, item, button, blocked));
  list.replaceChildren(...apps, ...saved);
  if (!apps.length && !saved.length)
    list.append(node("p", "secondary", "No stored apps or saves."));
}
function savedRow(
  manager: StorageManagement,
  item: SavedAppData,
  button: RowAction,
  blocked: (message: string) => void,
): HTMLDivElement {
  const row = node("div", "storage-app"),
    info = node("div");
  info.append(
    node("strong", "", item.namespace),
    node(
      "span",
      "secondary",
      item.bytes === undefined
        ? "Saved data · size unavailable"
        : `${formatBytes(item.bytes)} · saved data`,
    ),
  );
  row.append(
    info,
    button(
      `Delete saved data for ${item.namespace}`,
      `Delete saved data for ${item.namespace}? This cannot be undone.`,
      () => manager.removeSaved(item.namespace, blocked),
    ),
  );
  return row;
}
function button(
  label: string,
  description: string,
  operation: () => Promise<void>,
  execute: (operation: () => Promise<void>) => Promise<void>,
  failure: (error: unknown) => void,
): HTMLButtonElement {
  const result = node("button", "danger", "Delete");
  result.setAttribute("aria-label", label);
  result.addEventListener(
    "click",
    action(async () => {
      if (!(await confirmAction({ title: label + "?", description, action: "Delete" }))) return;
      await execute(async () => {
        result.disabled = true;
        await operation();
      });
    }, failure),
  );
  return result;
}
