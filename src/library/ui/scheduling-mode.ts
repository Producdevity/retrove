import {
  SchedulingChoice,
  schedulingChoice,
  setSchedulingChoice,
} from "../../runtime/ios/threads/scheduling";
import { element } from "../../ui/dom";

const choices: readonly string[] = Object.values(SchedulingChoice);
const isChoice = (value: string): value is SchedulingChoice => choices.includes(value);

/** When the one-core scheduler switches guest threads, from the next launch. */
export function connectSchedulingMode(failed: (error: unknown) => void): void {
  const control = element("scheduling-mode", HTMLFieldSetElement);
  const refresh = (): void => {
    const current = schedulingChoice();
    for (const option of control.querySelectorAll("input"))
      option.checked = option.value === current;
  };
  control.addEventListener("change", (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement) || !isChoice(option.value)) return;
    try {
      setSchedulingChoice(option.value);
    } catch (error) {
      failed(error);
    }
    refresh();
  });
  refresh();
}
