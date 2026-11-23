import { GeometryField, WORD_BYTES } from "../../abi/scalars";
import type { TouchBase } from "./context";
import { isLandscape } from "../screen";
import { applyAnimation, createViewData, type Rect, type ViewData } from "./view-data";

const MAX_CLASS_DEPTH = 64;
const SUPERCLASS_OFFSET = WORD_BYTES;

export interface ViewKit {
  data: (pointer: number) => ViewData;
  setFrame: (self: number, rect: Rect) => number;
  detach: (self: number) => void;
  attach: (parent: number, child: number) => void;
  bounds: () => Rect;
  key: (self: number) => void;
}

/** UIImageView and its subclasses start with userInteractionEnabled NO, so touches pass through. */
function inheritsImageView(base: TouchBase, pointer: number): boolean {
  const imageView = base.names.get("UIImageView");
  if (!imageView) return false;
  let cls = base.read(pointer);
  for (let depth = 0; cls && depth < MAX_CLASS_DEPTH; depth++) {
    if (cls === imageView) return true;
    cls = base.read(cls + SUPERCLASS_OFFSET);
  }
  return false;
}

export function createViewKit(base: TouchBase): ViewKit {
  const { state, services, phoneScreen, retain } = base;
  const data = (pointer: number): ViewData => {
    const existing = state.views.get(pointer);
    if (existing) return existing;
    const created = createViewData(!inheritsImageView(base, pointer));
    state.views.set(pointer, created);
    return created;
  };
  const setFrame = (self: number, rect: Rect): number => {
    const view = data(self);
    applyAnimation(
      view,
      "layoutAnimation",
      state.animation ?? services.animationGroups.get().context(),
    );
    const [, , width, height] = rect;
    if (
      view.bounds[GeometryField.Width] !== width ||
      view.bounds[GeometryField.Height] !== height
    ) {
      view.needsLayout = true;
      view.needsDisplay = true;
    }
    view.frame = rect;
    view.bounds[GeometryField.Width] = width;
    view.bounds[GeometryField.Height] = height;
    return self;
  };
  const detach = (self: number): void => {
    const view = data(self);
    if (view.parent) {
      const siblings = data(view.parent).children;
      const index = siblings.indexOf(self);
      if (index >= 0) siblings.splice(index, 1);
    }
    view.parent = 0;
  };
  const attach = (parent: number, child: number): void => {
    if (!child) return;
    for (let pointer = parent; pointer; pointer = data(pointer).parent) {
      if (pointer === child) throw new Error("UIView hierarchy cycle");
    }
    if (!data(child).parent) retain(child);
    detach(child);
    data(child).parent = parent;
    data(parent).children.push(child);
    data(parent).needsLayout = true;
    data(child).needsLayout = true;
  };
  const bounds = (): Rect => {
    const { width, height } = phoneScreen;
    return isLandscape(base.getOrientation()) ? [0, 0, height, width] : [0, 0, width, height];
  };
  const key = (self: number): void => {
    state.window = self;
    data(self).hidden = false;
    if (!data(self).bounds[GeometryField.Width]) setFrame(self, bounds());
  };
  return { data, setFrame, detach, attach, bounds, key };
}
