import { describe, expect, it } from "vite-plus/test";
import {
  indicatorsVisible,
  indicatorsWidth,
  pageControlState,
  setCurrentPage,
  setPages,
  tapPage,
} from "./model";

describe("page control model", () => {
  it("clamps the current page to the page count", () => {
    const state = pageControlState();
    setPages(state, 3);
    setCurrentPage(state, 5);
    expect(state.current).toBe(2);
    setPages(state, 2);
    expect([state.current, state.displayed]).toEqual([1, 1]);
    setCurrentPage(state, -4);
    expect(state.current).toBe(0);
  });
  it("pages left or right of the centre and stops at the ends", () => {
    const state = pageControlState();
    setPages(state, 3);
    expect(tapPage(state, 10, 100)).toBe(false);
    expect(tapPage(state, 80, 100)).toBe(true);
    expect(state.current).toBe(1);
    expect(tapPage(state, 20, 100)).toBe(true);
    expect(state.current).toBe(0);
  });
  it("defers the displayed page until asked", () => {
    const state = pageControlState();
    setPages(state, 4);
    state.defersDisplay = true;
    tapPage(state, 90, 100);
    expect([state.current, state.displayed]).toEqual([1, 0]);
  });
  it("hides a single page only when requested", () => {
    const state = pageControlState();
    setPages(state, 1);
    expect(indicatorsVisible(state)).toBe(true);
    state.hidesForSinglePage = true;
    expect(indicatorsVisible(state)).toBe(false);
    expect(indicatorsWidth(3)).toBe(39);
  });
});
