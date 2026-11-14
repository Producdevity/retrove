import type { UIKitHost } from "../host";
export const ALERT_CLASS = "UIAlertView";
export const AlertLimit = { Buttons: 64 } as const;
export const AlertArgument = { Cancel: 3, FirstOther: 4 } as const;
export const AlertCallback = {
  WillPresent: "willPresentAlertView:",
  DidPresent: "didPresentAlertView:",
  Click: "alertView:clickedButtonAtIndex:",
  Cancel: "alertViewCancel:",
  WillDismiss: "alertView:willDismissWithButtonIndex:",
  DidDismiss: "alertView:didDismissWithButtonIndex:",
} as const;
export interface AlertContent {
  title: string | undefined;
  message: string | undefined;
  buttons: string[];
  cancel: number;
}
export interface AlertOutput {
  update(content: AlertContent): void;
  close(): void;
}
export interface AlertHost extends UIKitHost {
  responds(pointer: number, selector: string): boolean;
}
export type AlertPresentation = (
  content: AlertContent,
  select: (index: number | undefined) => void,
) => AlertOutput;
export interface AlertState extends AlertContent {
  delegate: number;
  firstOther: number;
  phase: "hidden" | "presenting" | "visible" | "dismissing";
  output: AlertOutput | undefined;
  held: boolean;
}

export type AlertLifecycleHost = Pick<
  AlertHost,
  "retain" | "release" | "send" | "responds" | "deallocateView"
>;
