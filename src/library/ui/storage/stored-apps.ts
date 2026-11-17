import type { StorageInventory, StorageManagement } from "../../../storage/management/service";
import { node } from "../../../ui/dom";
import { formatBytes } from "../../../ui/format";
import type { AppIcons } from "../app-list";

export type DeleteButton = (
  label: string,
  description: string,
  operation: () => Promise<void>,
) => HTMLButtonElement;

interface StoredItem {
  readonly name: string;
  readonly icon: HTMLElement;
  readonly detail: string;
  readonly bytes: number;
  readonly remove: HTMLButtonElement;
}

function row(item: StoredItem): HTMLElement {
  const result = node("div", "storage-app"),
    text = node("div");
  text.append(node("strong", "", item.name), node("span", "", item.detail));
  result.append(item.icon, text, node("span", "value", formatBytes(item.bytes)), item.remove);
  return result;
}

/** Every app and every orphaned save, largest first, each with its own delete action. */
export function renderStoredApps(
  list: HTMLElement,
  icons: AppIcons,
  manager: StorageManagement,
  inventory: StorageInventory,
  button: DeleteButton,
  progress: (message: string) => void,
): void {
  icons.clear();
  const saves = new Map(inventory.saved.map((item) => [item.namespace, item.bytes ?? 0]));
  const items: StoredItem[] = inventory.apps.map((app) => {
    const saved = saves.get(app.bundleId) ?? 0;
    saves.delete(app.bundleId);
    return {
      name: app.name,
      icon: icons.create(app),
      detail: saved ? `Saves ${formatBytes(saved)}` : `Version ${app.version}`,
      bytes: app.size + saved,
      remove: button(
        `Delete ${app.name}`,
        "Its IPA, saves and settings are deleted. This cannot be undone.",
        () => manager.remove(app.id, true, progress),
      ),
    };
  });
  for (const [namespace, bytes] of saves)
    items.push({
      name: namespace,
      icon: node("div", "app-icon app-monogram", namespace.slice(0, 1).toUpperCase()),
      detail: "Saves without an app",
      bytes,
      remove: button(`Delete saves for ${namespace}`, "This cannot be undone.", () =>
        manager.removeSaved(namespace, progress),
      ),
    });
  items.sort((left, right) => right.bytes - left.bytes);
  list.replaceChildren(...items.map(row));
}
