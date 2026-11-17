import type { UIKitHost } from "../host";

export const TableClass = {
  Table: "UITableView",
  Cell: "UITableViewCell",
  Controller: "UITableViewController",
  ContentView: "UITableViewCellContentView",
} as const;
export interface TableHost extends UIKitHost {
  classNamed(name: string): number;
  responds(pointer: number, selector: string): boolean;
  parent(pointer: number): number;
  children(pointer: number): readonly number[];
  hasBackground(pointer: number): boolean;
  touchPoint(touches: number, view: number): readonly [number, number] | undefined;
  rgba(color: number): readonly number[] | undefined;
  imageSize(image: number): readonly [number, number];
  /** The UIImage shown by a UIImageView, or 0. */
  viewImage(view: number): number;
  /** An autoreleased NSArray that retains `values`. */
  array(values: readonly number[]): number;
  screenSize(): readonly [number, number];
  /** UIView's initWithCoder:, for subclasses that decode more keys. */
  decodeView(self: number, coder: number): Promise<number>;
}
/** Integer result of a guest call; NSInteger is signed. */
export function integerResult(value: unknown): number {
  return typeof value === "number" ? value | 0 : 0;
}
/** Object pointer result of an optional guest call; nil when the call did not happen. */
export function pointerResult(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
