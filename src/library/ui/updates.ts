import { errorMessage } from "../../domain/validation";
import { applyUpdate, updateRegistration, watchUpdates } from "../../pwa/updates";
import { element } from "../../ui/dom";

const UpdateState = {
  Off: "off",
  Checking: "checking",
  Current: "current",
  Downloading: "downloading",
  Ready: "ready",
  Applying: "applying",
  Failed: "failed",
} as const;
type UpdateState = (typeof UpdateState)[keyof typeof UpdateState];
const STATUS: Record<UpdateState, string> = {
  off: "Not available",
  checking: "Checking…",
  current: "Up to date",
  downloading: "Downloading…",
  ready: "Ready to install",
  applying: "Installing…",
  failed: "",
};
const ACTION: Partial<Record<UpdateState, string>> = {
  current: "Check now",
  ready: "Restart",
  failed: "Try again",
};
/** A launch that finds an update already downloaded installs it before the user starts. */
const LAUNCH_WINDOW_MS = 4_000;
const RECHECK_MS = 60_000;

/** Checks for updates in the background and installs them with at most one tap. */
export function connectUpdates(report: (error: unknown) => void): void {
  const status = element("update-status", HTMLSpanElement),
    action = element("update-action", HTMLButtonElement),
    banner = element("update-banner", HTMLDivElement),
    restart = element("update-restart", HTMLButtonElement);
  const started = performance.now();
  let registration: ServiceWorkerRegistration | undefined;
  let state: UpdateState = UpdateState.Checking;
  let checked = 0;
  const show = (next: UpdateState, message = ""): void => {
    state = next;
    status.textContent = message || STATUS[next];
    const label = ACTION[next];
    action.hidden = !label;
    action.textContent = label ?? "";
    action.classList.toggle("filled", next === UpdateState.Ready);
    banner.hidden = next !== UpdateState.Ready && next !== UpdateState.Applying;
    restart.disabled = next === UpdateState.Applying;
  };
  const install = async (current: ServiceWorkerRegistration): Promise<void> => {
    show(UpdateState.Applying);
    try {
      await applyUpdate(current);
      location.reload();
    } catch (error) {
      report(error);
      show(UpdateState.Failed, errorMessage(error));
    }
  };
  const check = async (current: ServiceWorkerRegistration): Promise<void> => {
    checked = performance.now();
    if (state === UpdateState.Current || state === UpdateState.Failed) show(UpdateState.Checking);
    try {
      await current.update();
    } catch {
      // Offline: the installed version keeps working.
    }
    if (state === UpdateState.Checking) show(UpdateState.Current);
    changed(current);
  };
  const changed = (current: ServiceWorkerRegistration): void => {
    if (state === UpdateState.Applying) return;
    if (current.waiting) {
      if (performance.now() - started < LAUNCH_WINDOW_MS) void install(current);
      else show(UpdateState.Ready);
    } else if (current.installing) show(UpdateState.Downloading);
    else if (state !== UpdateState.Checking) show(UpdateState.Current);
  };
  const run = (): void => {
    if (!registration) return;
    if (state === UpdateState.Ready) void install(registration);
    else void check(registration);
  };
  action.addEventListener("click", run);
  restart.addEventListener("click", run);
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    show(UpdateState.Off);
    return;
  }
  show(UpdateState.Checking);
  void updateRegistration().then(
    (value) => {
      registration = value;
      watchUpdates(value, () => changed(value));
      if (state === UpdateState.Checking) show(UpdateState.Current);
      changed(value);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && performance.now() - checked > RECHECK_MS)
          void check(value);
      });
      checked = performance.now();
    },
    (error: unknown) => {
      report(error);
      show(UpdateState.Failed, errorMessage(error));
    },
  );
}
