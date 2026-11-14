import type { UIKitHost } from "../host";
export const PICKER_CLASS = "UIPickerView";
export const PickerDefaults = {
  Height: 216,
  RowHeight: 44,
  Components: 32,
  TitleCache: 64,
  Half: 0.5,
  TapSlop: 8,
} as const;
export const MAX_PICKER_ROWS = 0x7fffffff;
export interface PickerHost extends UIKitHost {
  screenWidth(): number;
  responds(pointer: number, selector: string): boolean;
  touchPoint(touches: number, view: number): readonly [number, number] | undefined;
}
export interface PickerComponent {
  rows: number;
  selected: number;
  width: number;
  height: number;
  titles: Map<number, string>;
}
export interface PickerDrag {
  component: number;
  row: number;
  y: number;
  distance: number;
}
export interface PickerState {
  delegate: number;
  source: number;
  components: PickerComponent[];
  dirty: boolean;
  loading: boolean;
  revision: number;
  indicator: boolean;
  drag: PickerDrag | undefined;
}
