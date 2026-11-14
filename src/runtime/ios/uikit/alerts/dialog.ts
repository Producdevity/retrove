import type { AlertContent, AlertOutput } from "./types";
export function presentAlert(
  document: Document,
  content: AlertContent,
  select: (index: number | undefined) => void,
): AlertOutput {
  const dialog = document.createElement("dialog");
  dialog.className = "guest-alert";
  dialog.setAttribute("aria-label", content.title || "App alert");
  const heading = document.createElement("h2");
  const message = document.createElement("p");
  const buttons = document.createElement("div");
  buttons.className = "guest-alert-buttons";
  dialog.append(heading, message, buttons);
  const update = (value: AlertContent): void => {
    heading.textContent = value.title ?? "";
    heading.hidden = !value.title;
    message.textContent = value.message ?? "";
    message.hidden = !value.message;
    dialog.setAttribute("aria-label", value.title || "App alert");
    buttons.replaceChildren(
      ...value.buttons.map((title, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = title;
        button.className = index === value.cancel ? "guest-alert-cancel" : "";
        button.addEventListener("click", () => select(index));
        return button;
      }),
    );
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    select(undefined);
  });
  update(content);
  document.body.append(dialog);
  dialog.showModal();
  return {
    update,
    close: () => {
      dialog.close();
      dialog.remove();
    },
  };
}
