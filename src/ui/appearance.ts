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
export function connectAppearance(failed: (error: unknown) => void): void {
  const select = element("appearance", HTMLSelectElement);
  select.value = readPreference();
  select.addEventListener("change", () => {
    if (!isPreference(select.value)) return;
    apply(select.value);
    try {
      localStorage.setItem(STORAGE_KEY, select.value);
    } catch (error) {
      failed(error);
    }
  });
}
