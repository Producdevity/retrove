import { PointerPhase, TouchPhase } from "./pointer-queue";

export const POINTER_PHASES: Record<PointerPhase, readonly [number, string]> = {
  [PointerPhase.Down]: [TouchPhase.Began, "touchesBegan:withEvent:"],
  [PointerPhase.Move]: [TouchPhase.Moved, "touchesMoved:withEvent:"],
  [PointerPhase.Up]: [TouchPhase.Ended, "touchesEnded:withEvent:"],
  [PointerPhase.Cancel]: [TouchPhase.Cancelled, "touchesCancelled:withEvent:"],
};
export const BEGAN_SELECTOR = "touchesBegan:withEvent:";
export const CANCELLED_SELECTOR = "touchesCancelled:withEvent:";
