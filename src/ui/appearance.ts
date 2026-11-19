import { element } from "./dom";
const Preference = { System: "system", Light: "light", Dark: "dark" } as const;
type Preference = (typeof Preference)[keyof typeof Preference];
const STORAGE_KEY = "retrove.appearance";
function isPreference(value: unknown): value is Preference {
  return value === Preference.System || value === Preference.Light || value === Preference.Dark;
}
function readPreference(): Preference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isPreference(value) ? value : Preference.System;
  } catch {
    return Preference.System;
  }
}
function apply(preference: Preference): void {
  document.documentElement.dataset.theme = preference;
  // The launch script paints a ground before the stylesheets; from here the theme's tokens do.
  document.documentElement.style.removeProperty("background");
  const color = getComputedStyle(document.documentElement).backgroundColor;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}
export function initializeAppearance(): void {
  apply(readPreference());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
    apply(readPreference()),
  );
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) apply(readPreference());
  });
}
/** The theme control: one radio button per preference, styled as a segmented control. */
export function connectAppearance(failed: (error: unknown) => void): void {
  const control = element("appearance", HTMLFieldSetElement);
  const options = [...control.querySelectorAll("input")];
  const current = readPreference();
  for (const option of options) option.checked = option.value === current;
  control.addEventListener("change", (event) => {
    const option = event.target;
    if (!(option instanceof HTMLInputElement) || !isPreference(option.value)) return;
    apply(option.value);
    try {
      localStorage.setItem(STORAGE_KEY, option.value);
    } catch (error) {
      failed(error);
    }
  });
}
