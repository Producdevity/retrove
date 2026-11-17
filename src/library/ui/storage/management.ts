import { action, element, node } from "../../../ui/dom";
import { confirmAction } from "../../../ui/confirmation";
import { formatBytes } from "../../../ui/format";
import type { StorageManagement } from "../../../storage/management/service";
import type { TranslationSummary } from "../../../runtime/cpu/translation/translation-data";
import { AppIcons } from "../app-list";
import { storageBreakdown } from "./breakdown";
import { renderOverview } from "./overview";
import { renderStoredApps } from "./stored-apps";

interface Confirmed {
  readonly button: HTMLButtonElement;
  readonly title: string;
  readonly description: string;
  readonly confirm: string;
  readonly run: () => Promise<string>;
}

/** Settings › Storage: what uses space, per app, and the clean-up actions. */
class StoragePanel {
  private readonly panel = element("manage-storage", HTMLElement);
  private readonly list = element("stored-apps", HTMLDivElement);
  private readonly unused = element("unused-storage", HTMLSpanElement);
  private readonly translated = element("translation-storage", HTMLSpanElement);
  private readonly status = element("storage-status", HTMLParagraphElement);
  private readonly clean = element("clean-unused", HTMLButtonElement);
  private readonly clear = element("clear-apps", HTMLButtonElement);
  private readonly forget = element("clear-translations", HTMLButtonElement);
  private readonly overview = {
    total: element("storage", HTMLParagraphElement),
    bar: element("storage-bar", HTMLDivElement),
    legend: element("storage-legend", HTMLUListElement),
  };
  private readonly icons = new AppIcons();
  private busy = false;
  private readonly progress = (message: string): void => {
    this.status.textContent = message;
  };
  constructor(
    private readonly manager: StorageManagement,
    private readonly changed: () => Promise<void>,
    private readonly failure: (error: unknown) => void,
  ) {
    const actions = cleanupActions(manager, this.clean, this.clear, this.forget, this.progress);
    for (const confirmed of actions)
      confirmed.button.addEventListener(
        "click",
        action(async () => {
          const { title, description, confirm } = confirmed;
          if (!(await confirmAction({ title, description, action: confirm }))) return;
          await this.execute(async () => {
            this.status.textContent = await confirmed.run();
          });
        }, failure),
      );
  }
  readonly refresh = async (): Promise<void> => {
    const [inventory, translations, estimate] = await Promise.all([
      this.manager.snapshot(),
      this.manager.translationSummary(),
      navigator.storage.estimate(),
    ]);
    const imports = inventory.unused.reduce((sum, value) => sum + value.bytes, 0);
    const slices = storageBreakdown({
      apps: inventory.apps.reduce((sum, app) => sum + app.size, 0),
      saves: inventory.saved.reduce((sum, item) => sum + (item.bytes ?? 0), 0),
      translations: translations.bytes,
      imports,
      usage: estimate.usage,
    });
    renderOverview(this.overview, slices, estimate.quota);
    renderStoredApps(
      this.list,
      this.icons,
      this.manager,
      inventory,
      this.deleteButton,
      this.progress,
    );
    this.unused.textContent = imports ? formatBytes(imports) : "None";
    this.clean.disabled = this.busy || !inventory.unused.length;
    this.translated.textContent = translatedSize(translations);
    this.forget.disabled = this.busy || !(translations.modules + translations.apps);
  };
  private readonly deleteButton = (
    label: string,
    description: string,
    operation: () => Promise<void>,
  ): HTMLButtonElement => {
    const result = node("button", "danger", "Delete");
    result.setAttribute("aria-label", label);
    result.addEventListener(
      "click",
      action(async () => {
        if (!(await confirmAction({ title: `${label}?`, description, action: "Delete" }))) return;
        await this.execute(async () => {
          result.disabled = true;
          await operation();
        });
      }, this.failure),
    );
    return result;
  };
  private async execute(operation: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.panel.classList.add("busy");
    this.clean.disabled = this.clear.disabled = this.forget.disabled = true;
    try {
      await operation();
      await this.changed();
    } catch (error) {
      await this.refresh().catch(this.failure);
      throw error;
    } finally {
      this.busy = false;
      this.panel.classList.remove("busy");
      this.clear.disabled = false;
    }
  }
}

export function connectStorageManagement(
  manager: StorageManagement,
  changed: () => Promise<void>,
  failure: (error: unknown) => void,
): () => Promise<void> {
  return new StoragePanel(manager, changed, failure).refresh;
}

/** Modules stored before sizes were recorded have no size yet; their count is shown instead. */
function translatedSize({ bytes, modules }: TranslationSummary): string {
  if (bytes) return formatBytes(bytes);
  if (modules) return `${modules} ${modules === 1 ? "module" : "modules"}`;
  return "None";
}

function cleanupActions(
  manager: StorageManagement,
  clean: HTMLButtonElement,
  clear: HTMLButtonElement,
  forget: HTMLButtonElement,
  progress: (message: string) => void,
): Confirmed[] {
  return [
    {
      button: clean,
      title: "Remove unfinished imports?",
      description: "These are archives from imports that did not finish. Apps and saves are kept.",
      confirm: "Remove",
      run: async () => {
        const count = await manager.cleanUnused();
        return `Removed ${count} unfinished ${count === 1 ? "import" : "imports"}.`;
      },
    },
    {
      button: forget,
      title: "Clear translated code?",
      description: "Each app starts slower once while its code is translated again.",
      confirm: "Clear",
      run: async () => {
        await manager.clearTranslations();
        return "Translated code cleared.";
      },
    },
    {
      button: clear,
      title: "Delete all apps and saves?",
      description:
        "Every IPA, save, setting and translated code is deleted. This cannot be undone.",
      confirm: "Delete all",
      run: async () => {
        await manager.clear(progress);
        return "All apps and saves deleted.";
      },
    },
  ];
}
