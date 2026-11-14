export const LayerGravitySymbols = {
  _kCAGravityCenter: "center",
  _kCAGravityTop: "top",
  _kCAGravityBottom: "bottom",
  _kCAGravityLeft: "left",
  _kCAGravityRight: "right",
  _kCAGravityTopLeft: "topLeft",
  _kCAGravityTopRight: "topRight",
  _kCAGravityBottomLeft: "bottomLeft",
  _kCAGravityBottomRight: "bottomRight",
  _kCAGravityResize: "resize",
  _kCAGravityResizeAspect: "resizeAspect",
  _kCAGravityResizeAspectFill: "resizeAspectFill",
} as const;
const GRAVITY_MODES: Readonly<Record<string, number>> = {
  resize: 0,
  resizeAspect: 1,
  resizeAspectFill: 2,
  center: 4,
  top: 5,
  bottom: 6,
  left: 7,
  right: 8,
  topLeft: 9,
  topRight: 10,
  bottomLeft: 11,
  bottomRight: 12,
};
export function layerGravityMode(value: string): number {
  const mode = GRAVITY_MODES[value];
  if (mode === undefined) throw new Error(`Unsupported CALayer contents gravity ${value}.`);
  return mode;
}
