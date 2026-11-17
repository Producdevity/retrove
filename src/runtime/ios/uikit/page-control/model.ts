export const PageIndicator = {
  Diameter: 7,
  Gap: 9,
  Height: 36,
  InactiveOpacity: 0.3,
  Half: 0.5,
} as const;
export interface PageControlState {
  pages: number;
  current: number;
  displayed: number;
  hidesForSinglePage: boolean;
  defersDisplay: boolean;
}
export function pageControlState(): PageControlState {
  return { pages: 0, current: 0, displayed: 0, hidesForSinglePage: false, defersDisplay: false };
}
function clamp(page: number, pages: number): number {
  return Math.max(0, Math.min(page, pages - 1));
}
export function setPages(state: PageControlState, pages: number): void {
  state.pages = Math.max(0, pages | 0);
  state.current = clamp(state.current, state.pages);
  state.displayed = clamp(state.displayed, state.pages);
}
export function setCurrentPage(state: PageControlState, page: number): void {
  state.current = clamp(page | 0, state.pages);
  state.displayed = state.current;
}
/** Returns whether the tap changed the current page. */
export function tapPage(state: PageControlState, x: number, width: number): boolean {
  const next = clamp(state.current + (x < width * PageIndicator.Half ? -1 : 1), state.pages);
  if (next === state.current) return false;
  state.current = next;
  if (!state.defersDisplay) state.displayed = next;
  return true;
}
export function indicatorsVisible(state: PageControlState): boolean {
  return state.pages > 1 || (state.pages === 1 && !state.hidesForSinglePage);
}
export function indicatorsWidth(pages: number): number {
  return pages > 0 ? pages * PageIndicator.Diameter + (pages - 1) * PageIndicator.Gap : 0;
}
