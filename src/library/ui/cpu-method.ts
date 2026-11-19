import { ownCpuEnabled, setOwnCpuEnabled } from "../../runtime/cpu/translation/settings";
import { deviceBudget } from "../../runtime/memory/device-budget";
import { TOUCH_LIMIT_MB } from "../../runtime/memory/touch-check";
import { element } from "../../ui/dom";

const MEGABYTES_PER_GIGABYTE = 1024;
const MEBIBYTE = 1_048_576;
const Method = { Own: "own", Unicorn: "unicorn" } as const;

function note(own: boolean): string {
  const budget = deviceBudget();
  if (!budget.translation)
    return "This device has too little memory for translated code, so games use the interpreter.";
  const code = `Translated code budget ${budget.codeBytes / MEBIBYTE} MB.`;
  return own
    ? `Translated runs games as WebAssembly and is much faster. ${code}`
    : "The interpreter is slower but uses less memory. It applies from the next launch.";
}

function limit(): string {
  const touchMB = deviceBudget().touchMB;
  if (touchMB === undefined) return "Not measured yet";
  if (touchMB >= TOUCH_LIMIT_MB) return `${TOUCH_LIMIT_MB / MEGABYTES_PER_GIGABYTE} GB or more`;
  return `${(touchMB / MEGABYTES_PER_GIGABYTE).toFixed(1)} GB`;
}

/** The CPU method games launch with, and the device memory it was chosen against. */
export function connectCpuMethod(failed: (error: unknown) => void): () => void {
  const control = element("cpu-method", HTMLFieldSetElement);
  const footer = element("cpu-method-note", HTMLParagraphElement);
  const memory = element("memory-limit", HTMLSpanElement);
  const refresh = (): void => {
    const own = ownCpuEnabled();
    for (const option of control.querySelectorAll("input"))
      option.checked = option.value === (own ? Method.Own : Method.Unicorn);
    footer.textContent = note(own);
    memory.textContent = limit();
  };
  control.addEventListener("change", (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement)) return;
    try {
      setOwnCpuEnabled(option.value === Method.Own);
    } catch (error) {
      failed(error);
    }
    refresh();
  });
  refresh();
  return refresh;
}
