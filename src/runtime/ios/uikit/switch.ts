import { Argument } from "../objc/host";
import { GeometryField, floatFromBits } from "../abi/scalars";
import { CONTROL_CLASS, type ControlHost, type Controls } from "./control-host";
import { ControlEvent } from "./control-actions";

const SWITCH_CLASS = "UISwitch";
/** UISwitch keeps its own size before iOS 7. */
const SWITCH_WIDTH = 94;
const SWITCH_HEIGHT = 27;
export const SWITCH_SIZE = [SWITCH_WIDTH, SWITCH_HEIGHT] as const;
const LABEL_FONT = "bold 17px Helvetica, Arial, sans-serif";
const Paint = {
  On: "rgb(0,127,234)",
  Off: "rgb(238,238,238)",
  OnText: "#fff",
  OffText: "rgb(128,128,128)",
  Border: "rgba(0,0,0,0.35)",
  Knob: "rgb(250,250,250)",
} as const;
const HALF = 0.5;
const KNOB_INSET = 1;
const DISABLED_ALPHA = 0.5;
const TURNS = 2;
const FULL_TURN = Math.PI * TURNS;

export type SwitchCanvas = Pick<
  CanvasRenderingContext2D,
  | "globalAlpha"
  | "fillStyle"
  | "strokeStyle"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "arc"
  | "closePath"
  | "fill"
  | "stroke"
  | "fillText"
>;
export interface SwitchHost extends ControlHost {
  rgba(color: number): readonly number[] | undefined;
}
interface SwitchState {
  on: boolean;
  tint: number;
}
export interface Switches {
  has(pointer: number): boolean;
  draw(pointer: number, context: CanvasRenderingContext2D): void;
}

function pill(context: SwitchCanvas, x: number, y: number, w: number, h: number) {
  const radius = h * HALF;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.arc(x + w - radius, y + radius, radius, -Math.PI * HALF, Math.PI * HALF);
  context.lineTo(x + radius, y + h);
  context.arc(x + radius, y + radius, radius, Math.PI * HALF, Math.PI * (1 + HALF));
  context.closePath();
}
const CHANNEL_MAX = 255;
const RGB_CHANNELS = 3;
function tintCss(rgba: readonly number[] | undefined): string | undefined {
  if (!rgba || rgba.length < RGB_CHANNELS) return undefined;
  const [red = 0, green = 0, blue = 0] = rgba.map((value) => Math.round(value * CHANNEL_MAX));
  return `rgb(${red},${green},${blue})`;
}

/** Draws a pre-iOS 7 switch: a pill with ON or OFF and a round knob on the far side. */
export function drawSwitch(
  context: SwitchCanvas,
  bounds: readonly number[],
  on: boolean,
  enabled: boolean,
  tint: string | undefined,
): void {
  const [x = 0, y = 0, w = 0, h = 0] = bounds;
  context.save();
  if (!enabled) context.globalAlpha = DISABLED_ALPHA;
  pill(context, x, y, w, h);
  context.fillStyle = on ? (tint ?? Paint.On) : Paint.Off;
  context.fill();
  context.strokeStyle = Paint.Border;
  context.stroke();
  context.font = LABEL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = on ? Paint.OnText : Paint.OffText;
  const textCenter = on ? x + (w - h) * HALF : x + h + (w - h) * HALF;
  context.fillText(on ? "ON" : "OFF", textCenter, y + h * HALF);
  const radius = h * HALF - KNOB_INSET;
  context.beginPath();
  context.arc(on ? x + w - h * HALF : x + h * HALF, y + h * HALF, radius, 0, FULL_TURN);
  context.fillStyle = Paint.Knob;
  context.fill();
  context.strokeStyle = Paint.Border;
  context.stroke();
  context.restore();
}

export function installSwitches(host: SwitchHost, controls: Controls): Switches {
  host.hostClass(SWITCH_CLASS, CONTROL_CLASS);
  const states = new Map<number, SwitchState>();
  const state = (self: number): SwitchState => {
    let value = states.get(self);
    if (!value) {
      value = { on: false, tint: 0 };
      states.set(self, value);
    }
    return value;
  };
  const changed = (self: number) => {
    host.view(self).needsDisplay = true;
  };
  host.method(SWITCH_CLASS, false, "initWithFrame:", (self, args) => {
    state(self);
    return host.setFrame(self, [
      floatFromBits(args(GeometryField.X)),
      floatFromBits(args(GeometryField.Y)),
      ...SWITCH_SIZE,
    ]);
  });
  host.method(SWITCH_CLASS, false, "init", (self) => {
    state(self);
    return host.setFrame(self, [0, 0, ...SWITCH_SIZE]);
  });
  host.method(SWITCH_CLASS, false, "isOn", (self) => Number(state(self).on));
  for (const name of ["setOn:", "setOn:animated:"])
    host.method(SWITCH_CLASS, false, name, (self, args) => {
      state(self).on = Boolean(args(Argument.First));
      changed(self);
    });
  host.method(SWITCH_CLASS, false, "onTintColor", (self) => state(self).tint);
  host.method(SWITCH_CLASS, false, "setOnTintColor:", async (self, args) => {
    const value = state(self),
      old = value.tint;
    value.tint = args(Argument.First) ? host.retain(args(Argument.First)) : 0;
    if (old) await host.release(old);
    changed(self);
  });
  for (const [selector, kind] of [
    ["touchesBegan:withEvent:", "begin"],
    ["touchesMoved:withEvent:", "move"],
    ["touchesCancelled:withEvent:", "cancel"],
  ] as const)
    host.method(SWITCH_CLASS, false, selector, (self, args) =>
      controls.touch(self, kind, args(Argument.First), args(Argument.Second)),
    );
  host.method(SWITCH_CLASS, false, "touchesEnded:withEvent:", async (self, args) => {
    const tracking = controls.get(self).tracking,
      inside = host.touchInside(args(Argument.First), self);
    await controls.touch(self, "end", args(Argument.First), args(Argument.Second));
    if (!tracking || !inside) return;
    state(self).on = !state(self).on;
    changed(self);
    await controls.dispatch(self, ControlEvent.ValueChanged, args(Argument.Second));
  });
  host.method(SWITCH_CLASS, false, "dealloc", async (self) => {
    const old = states.get(self)?.tint;
    states.delete(self);
    if (old) await host.release(old);
    controls.remove(self);
    await host.deallocateView(self);
  });
  return {
    has: (pointer) => states.has(pointer),
    draw: (pointer, context) => {
      const value = state(pointer);
      drawSwitch(
        context,
        host.view(pointer).bounds,
        value.on,
        controls.get(pointer).enabled,
        tintCss(value.tint ? host.rgba(value.tint) : undefined),
      );
    },
  };
}
