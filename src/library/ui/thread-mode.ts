import {
  setWorkerThreadsEnabled,
  workerThreadsEnabled,
} from "../../runtime/cpu/translation/settings";
import { element } from "../../ui/dom";

const Mode = { One: "one", Parallel: "parallel" } as const;

/** Whether app profiles' guest threads run on execution workers, from the next launch. */
export function connectThreadMode(failed: (error: unknown) => void): void {
  const control = element("thread-mode", HTMLFieldSetElement);
  const refresh = (): void => {
    const parallel = workerThreadsEnabled();
    for (const option of control.querySelectorAll("input"))
      option.checked = option.value === (parallel ? Mode.Parallel : Mode.One);
  };
  control.addEventListener("change", (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement)) return;
    try {
      setWorkerThreadsEnabled(option.value === Mode.Parallel);
    } catch (error) {
      failed(error);
    }
    refresh();
  });
  refresh();
}
