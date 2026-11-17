import { node } from "../../../ui/dom";
import { formatBytes } from "../../../ui/format";
import { CATEGORY_LABELS, type StorageSlice } from "./breakdown";

export interface OverviewElements {
  readonly total: HTMLElement;
  readonly bar: HTMLElement;
  readonly legend: HTMLElement;
}

/** The used-space line, the stacked bar and its legend, as in the system storage settings. */
export function renderOverview(
  elements: OverviewElements,
  slices: readonly StorageSlice[],
  quota: number | undefined,
): void {
  const used = slices.reduce((sum, slice) => sum + slice.bytes, 0);
  const amount = node("strong", "", `${formatBytes(used)} used`);
  elements.total.replaceChildren(amount);
  if (quota) elements.total.append(node("span", "", ` of ${formatBytes(quota)}`));
  elements.bar.replaceChildren(
    ...slices.map((slice) => {
      const segment = node("span", "segment");
      segment.dataset["category"] = slice.category;
      segment.style.flexGrow = String(slice.bytes);
      return segment;
    }),
  );
  elements.bar.setAttribute(
    "aria-label",
    slices
      .map((slice) => `${CATEGORY_LABELS[slice.category]} ${formatBytes(slice.bytes)}`)
      .join(", ") || "Nothing stored",
  );
  elements.legend.replaceChildren(
    ...slices.map((slice) => {
      const item = node("li");
      item.dataset["category"] = slice.category;
      item.append(
        node("span", "", CATEGORY_LABELS[slice.category]),
        node("span", "value", formatBytes(slice.bytes)),
      );
      return item;
    }),
  );
}
