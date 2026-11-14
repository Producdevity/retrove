import "../ui/appearance.css";
import "../library/ui/library.css";
import { initializeAppearance } from "../ui/appearance";
import { element, action } from "../ui/dom";
import { errorMessage } from "../domain/validation";
import { applyUpdate, updateRegistration, watchUpdates } from "./updates";
import { BUILD_ID } from "./update-protocol";
initializeAppearance();
element("update-build", HTMLParagraphElement).textContent = `Build ${BUILD_ID}`;
const status = element("update-status", HTMLParagraphElement),
  button = element("apply-update", HTMLButtonElement);
const failure = (error: unknown) => {
  status.textContent = errorMessage(error);
  button.disabled = false;
};
let registration: ServiceWorkerRegistration | undefined;
button.addEventListener(
  "click",
  action(async () => {
    if (!registration) return;
    button.disabled = true;
    status.textContent = "Applying update…";
    await applyUpdate(registration);
    location.replace("/");
  }, failure),
);
void updateRegistration()
  .then((value) => {
    registration = value;
    watchUpdates(value, (ready) => {
      button.disabled = !ready;
      status.textContent = ready
        ? "Update ready. Your apps and saves will be kept."
        : value.installing
          ? "Downloading update…"
          : "Retrove is up to date. Return to your library.";
    });
  })
  .catch(failure);
