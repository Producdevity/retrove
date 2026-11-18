import { element } from "../ui/dom";

export const Orientation = { Auto: "auto", Portrait: "portrait", Landscape: "landscape" } as const;
export type Orientation = (typeof Orientation)[keyof typeof Orientation];
/** The quarter turn the page needs; empty when the screen already matches. */
export type Turn = "" | "90" | "-90";
const KEY_PREFIX = "retrove.orientation.";

function isOrientation(value: unknown): value is Orientation {
  return Object.values(Orientation).some((item) => item === value);
}
/**
 * Turns the player when the chosen orientation differs from how the screen is held, so a
 * game fills the screen with rotation lock on.
 */
export function turnFor(choice: Orientation, screenIsPortrait: boolean): Turn {
  if (choice === Orientation.Landscape && screenIsPortrait) return "90";
  if (choice === Orientation.Portrait && !screenIsPortrait) return "-90";
  return "";
}
function read(app: string): Orientation {
  try {
    const value = localStorage.getItem(KEY_PREFIX + app);
    return isOrientation(value) ? value : Orientation.Auto;
  } catch {
    return Orientation.Auto;
  }
}
function save(app: string, choice: Orientation): void {
  try {
    localStorage.setItem(KEY_PREFIX + app, choice);
  } catch {
    /* The choice still applies for this session. */
  }
}

/** The orientation menu: remembered per app, applied as a quarter turn of the whole page. */
export function connectOrientation(app: string): void {
  const menu = element("orientation-menu", HTMLElement);
  let choice = read(app);
  const apply = (): void => {
    const turn = turnFor(choice, innerHeight >= innerWidth);
    if (turn) document.body.dataset["turn"] = turn;
    else delete document.body.dataset["turn"];
  };
  for (const input of menu.querySelectorAll<HTMLInputElement>('input[name="orientation"]')) {
    input.checked = input.value === choice;
    input.addEventListener("change", () => {
      if (!input.checked || !isOrientation(input.value)) return;
      choice = input.value;
      save(app, choice);
      apply();
    });
  }
  addEventListener("resize", apply);
  apply();
}
