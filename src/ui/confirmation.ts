import { node } from "./dom";
const ACCEPT = "confirm";
interface Confirmation {
  readonly title: string;
  readonly description: string;
  readonly action: string;
}
export function confirmAction(options: Confirmation): Promise<boolean> {
  const dialog = node("dialog", "confirm-dialog"),
    form = node("form"),
    actions = node("div", "dialog-actions");
  dialog.setAttribute("aria-label", options.title);
  form.method = "dialog";
  const cancel = node("button", "", "Cancel"),
    accept = node("button", "danger", options.action);
  cancel.value = "cancel";
  accept.value = ACCEPT;
  actions.append(cancel, accept);
  form.append(node("h2", "", options.title), node("p", "", options.description), actions);
  dialog.append(form);
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        const accepted = dialog.returnValue === ACCEPT;
        dialog.remove();
        resolve(accepted);
      },
      { once: true },
    );
    dialog.showModal();
    cancel.focus();
  });
}
