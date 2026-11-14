import { layerGravityMode } from "./image/content-gravity";
import { floatBits, floatFromBits, WORD_BYTES, GeometryField } from "../abi/scalars";
import { structureMethod, type UIKitHost, type ViewState } from "./host";
const LAYER_CLASS = "CALayer";
const DEFAULT_ANCHOR = 0.5;
const POINT_COMPONENTS = 2;
type Point = [number, number];
interface LayerState extends ViewState {
  anchorPoint?: Point;
  contents?: number;
  contentsGravity?: string;
  zPosition?: number;
  contentMode?: number;
  alpha: number;
  needsDisplayOnBoundsChange?: boolean;
  hidden: boolean;
}
interface LayerPropertyHost extends Pick<
  UIKitHost,
  "method" | "structure" | "write" | "view" | "setFrame" | "text" | "string" | "autorelease"
> {
  view(pointer: number): LayerState;
  geometry(pointer: number): LayerState;
  changed(pointer: number, opacity: boolean): void;
  pixels(pointer: number): unknown;
  retainImage(pointer: number): void;
  releaseImage(pointer: number): Promise<void>;
}
export function installLayerProperties(host: LayerPropertyHost): void {
  installLayerContents(host);
  installLayerDepth(host);
  host.method(LAYER_CLASS, false, "needsDisplayOnBoundsChange", (self) =>
    Number(Boolean(host.geometry(self).needsDisplayOnBoundsChange)),
  );
  host.method(LAYER_CLASS, false, "setNeedsDisplayOnBoundsChange:", (self, args) => {
    host.geometry(self).needsDisplayOnBoundsChange = Boolean(args(0));
  });
  installLayerAnchor(host);
  host.structure(
    LAYER_CLASS,
    false,
    "position",
    structureMethod((self, _, out) => {
      const state = host.geometry(self),
        anchor = state.anchorPoint ?? [DEFAULT_ANCHOR, DEFAULT_ANCHOR];
      for (let index = 0; index < POINT_COMPONENTS; index++)
        host.write(
          out + index * WORD_BYTES,
          floatBits(
            (state.frame[index] ?? 0) +
              (anchor[index] ?? 0) * (state.frame[index + POINT_COMPONENTS] ?? 0),
          ),
        );
    }),
  );
  host.method(LAYER_CLASS, false, "setPosition:", (self, args) => {
    const state = host.geometry(self),
      anchor = state.anchorPoint ?? [DEFAULT_ANCHOR, DEFAULT_ANCHOR];
    for (let index = 0; index < POINT_COMPONENTS; index++)
      state.frame[index] =
        floatFromBits(args(index)) -
        (anchor[index] ?? 0) * (state.frame[index + POINT_COMPONENTS] ?? 0);
    host.changed(self, false);
  });
  host.method(LAYER_CLASS, false, "setBounds:", (self, args) => {
    const state = host.geometry(self),
      previous = state.bounds,
      anchor = state.anchorPoint ?? [DEFAULT_ANCHOR, DEFAULT_ANCHOR];
    const next: [number, number, number, number] = [
      floatFromBits(args(0)),
      floatFromBits(args(1)),
      floatFromBits(args(POINT_COMPONENTS)),
      floatFromBits(args(GeometryField.Height)),
    ];
    state.frame[0] += (previous[POINT_COMPONENTS] - next[POINT_COMPONENTS]) * anchor[0];
    state.frame[1] += (previous[GeometryField.Height] - next[GeometryField.Height]) * anchor[1];
    state.frame[POINT_COMPONENTS] = next[POINT_COMPONENTS];
    state.frame[GeometryField.Height] = next[GeometryField.Height];
    state.bounds = next;
    if (state.needsDisplayOnBoundsChange) state.needsDisplay = true;
    state.needsLayout = true;
    host.changed(self, false);
  });
  host.method(LAYER_CLASS, false, "opacity", (self) => floatBits(host.geometry(self).alpha));
  host.method(LAYER_CLASS, false, "setOpacity:", (self, args) => {
    host.geometry(self).alpha = floatFromBits(args(0));
    host.changed(self, true);
  });
  host.method(LAYER_CLASS, false, "isHidden", (self) => Number(host.geometry(self).hidden));
  host.method(LAYER_CLASS, false, "setHidden:", (self, args) => {
    host.geometry(self).hidden = Boolean(args(0));
  });
}

function installLayerContents(host: LayerPropertyHost): void {
  host.method(LAYER_CLASS, false, "contentsGravity", (self) =>
    host.autorelease(host.string(host.view(self).contentsGravity ?? "resize")),
  );
  host.method(LAYER_CLASS, false, "setContentsGravity:", (self, args) => {
    const gravity = host.text(args(0)),
      state = host.view(self);
    state.contentMode = layerGravityMode(gravity);
    state.contentsGravity = gravity;
    state.needsDisplay = true;
  });
  host.method(LAYER_CLASS, false, "contents", (self) => host.view(self).contents ?? 0);
  host.method(LAYER_CLASS, false, "setContents:", async (self, args) => {
    const value = args(0),
      state = host.view(self),
      old = state.contents;
    if (value && !host.pixels(value)) throw new Error("Unsupported CALayer contents object.");
    if (value) host.retainImage(value);
    state.contents = value;
    state.needsDisplay = true;
    if (old) await host.releaseImage(old);
  });
}

function installLayerAnchor(host: LayerPropertyHost): void {
  host.structure(
    LAYER_CLASS,
    false,
    "anchorPoint",
    structureMethod((self, _, out) => {
      const point = host.geometry(self).anchorPoint ?? [DEFAULT_ANCHOR, DEFAULT_ANCHOR];
      point.forEach((value, index) => host.write(out + index * WORD_BYTES, floatBits(value)));
    }),
  );
  host.method(LAYER_CLASS, false, "setAnchorPoint:", (self, args) => {
    const state = host.geometry(self),
      old: Point = state.anchorPoint ?? [DEFAULT_ANCHOR, DEFAULT_ANCHOR],
      point: Point = [floatFromBits(args(0)), floatFromBits(args(1))];
    if (!point.every(Number.isFinite)) throw new Error("Invalid CALayer anchor point.");
    state.frame[0] += (old[0] - point[0]) * state.frame[POINT_COMPONENTS];
    state.frame[1] += (old[1] - point[1]) * state.frame[GeometryField.Height];
    state.anchorPoint = point;
    host.changed(self, false);
  });
}

function installLayerDepth(host: LayerPropertyHost): void {
  host.method(LAYER_CLASS, false, "zPosition", (self) =>
    floatBits(host.geometry(self).zPosition ?? 0),
  );
  host.method(LAYER_CLASS, false, "setZPosition:", (self, args) => {
    const value = floatFromBits(args(0));
    if (!Number.isFinite(value)) throw new Error("Invalid CALayer depth.");
    host.geometry(self).zPosition = value;
  });
}
