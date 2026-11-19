import type { DrawablePlacement, Point } from "../drawable-placement";

export interface AllocateCommand {
  readonly target: number;
  readonly drawable: number;
  readonly colorFormat: string;
  readonly size: { readonly width: number; readonly height: number } | null;
}
export interface PresentCommand {
  readonly target: number;
  readonly placements: readonly (readonly [number, DrawablePlacement])[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
const integer = (value: unknown): value is number => Number.isInteger(value);
const POINT_LENGTH = 2;
const point = (value: unknown): value is Point =>
  Array.isArray(value) &&
  value.length === POINT_LENGTH &&
  value.every((part) => typeof part === "number");
const placement = (value: unknown): value is DrawablePlacement =>
  record(value) && point(value.origin) && point(value.u) && point(value.v);
const size = (value: unknown): value is { width: number; height: number } =>
  record(value) && integer(value.width) && integer(value.height);

export function isAllocateCommand(value: unknown): value is AllocateCommand {
  return (
    record(value) &&
    integer(value.target) &&
    integer(value.drawable) &&
    typeof value.colorFormat === "string" &&
    (value.size === null || size(value.size))
  );
}
export function isPresentCommand(value: unknown): value is PresentCommand {
  return (
    record(value) &&
    integer(value.target) &&
    Array.isArray(value.placements) &&
    value.placements.every(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry.length === POINT_LENGTH &&
        integer(entry[0]) &&
        placement(entry[1]),
    )
  );
}
