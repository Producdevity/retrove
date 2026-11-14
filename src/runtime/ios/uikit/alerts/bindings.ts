import { Argument } from "../../objc/host";
import { Alerts } from "./model";
import { presentAlert } from "./dialog";
import { ALERT_CLASS, AlertLimit, AlertArgument } from "./types";
import type { AlertHost, AlertState } from "./types";
function addButton(host: AlertHost, state: AlertState, pointer: number): number {
  if (state.buttons.length >= AlertLimit.Buttons)
    throw new Error("UIAlertView button limit exceeded.");
  state.buttons.push(pointer ? host.text(pointer) : "");
  return state.buttons.length - 1;
}
function properties(host: AlertHost, alerts: Alerts): void {
  for (const [field, setter] of [
    ["title", "setTitle:"],
    ["message", "setMessage:"],
  ] as const) {
    host.method(ALERT_CLASS, false, field, (self) => {
      const value = alerts.get(self)[field];
      return value === undefined ? 0 : host.string(value);
    });
    host.method(ALERT_CLASS, false, setter, (self, args) => {
      alerts.get(self)[field] = args(0) ? host.text(args(0)) : undefined;
      alerts.update(self);
    });
  }
  host.method(ALERT_CLASS, false, "delegate", (self) => alerts.get(self).delegate);
  host.method(ALERT_CLASS, false, "setDelegate:", (self, args) => {
    alerts.get(self).delegate = args(0);
  });
  host.method(ALERT_CLASS, false, "cancelButtonIndex", (self) => alerts.get(self).cancel);
  host.method(ALERT_CLASS, false, "setCancelButtonIndex:", (self, args) => {
    alerts.get(self).cancel = args(0) | 0;
    alerts.update(self);
  });
  host.method(ALERT_CLASS, false, "firstOtherButtonIndex", (self) => alerts.get(self).firstOther);
  host.method(ALERT_CLASS, false, "numberOfButtons", (self) => alerts.get(self).buttons.length);
  host.method(ALERT_CLASS, false, "isVisible", (self) => Number(alerts.visible(self)));
  host.method(ALERT_CLASS, false, "alertViewStyle", () => 0);
  host.method(ALERT_CLASS, false, "setAlertViewStyle:", (_self, args) => {
    if (args(0) !== 0) throw new Error("UIAlertView text input styles are not implemented.");
  });
  host.method(ALERT_CLASS, false, "textFieldAtIndex:", () => 0);
}
export function installAlerts(host: AlertHost): Alerts {
  host.hostClass(ALERT_CLASS, "UIView");
  const alerts = new Alerts(host, (content, select) => {
    if (!host.document) throw new Error("UIAlertView requires a display document.");
    return presentAlert(host.document, content, select);
  });
  host.method(
    ALERT_CLASS,
    false,
    "initWithTitle:message:delegate:cancelButtonTitle:otherButtonTitles:",
    (self, args) => {
      const state = alerts.get(self);
      state.title = args(Argument.First) ? host.text(args(Argument.First)) : undefined;
      state.message = args(Argument.Second) ? host.text(args(Argument.Second)) : undefined;
      state.delegate = args(Argument.Third);
      const cancel = args(AlertArgument.Cancel);
      if (cancel) state.cancel = addButton(host, state, cancel);
      for (let index = AlertArgument.FirstOther; ; index++) {
        const title = args(index);
        if (!title) break;
        const button = addButton(host, state, title);
        if (state.firstOther < 0) state.firstOther = button;
      }
      return self;
    },
  );
  host.method(ALERT_CLASS, false, "addButtonWithTitle:", (self, args) => {
    const index = addButton(host, alerts.get(self), args(0));
    alerts.update(self);
    return index;
  });
  host.method(ALERT_CLASS, false, "buttonTitleAtIndex:", (self, args) => {
    const title = alerts.get(self).buttons[args(0)];
    return title === undefined ? 0 : host.string(title);
  });
  host.method(ALERT_CLASS, false, "show", (self) => alerts.show(self));
  host.method(ALERT_CLASS, false, "dismissWithClickedButtonIndex:animated:", (self, args) =>
    alerts.dismiss(self, args(0) | 0),
  );
  host.method(ALERT_CLASS, false, "dealloc", (self) => alerts.destroy(self));
  properties(host, alerts);
  return alerts;
}
