import { errorMessage } from "../../domain/validation";
import { BUILD_ID } from "../../pwa/update-protocol";
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
const ANNOUNCE_MS = 8_000;
/** Set just before the restart that applies an update, so the next launch can confirm it. */
const UPDATED_FROM_KEY = "retrove.updated-from";
interface BannerCopy {
  readonly title: string;
  readonly detail: string;
  readonly action: string;
}
const BANNER: Partial<Record<UpdateState, BannerCopy>> = {
  ready: { title: "Update ready", detail: "Restart to use the new version.", action: "Restart" },
  applying: { title: "Updating Retrove", detail: "Restarting with the new version…", action: "" },
};

/** The floating update banner: progress of an update, then a confirmation after its restart. */
class UpdateBanner {
  private readonly bar = element("update-banner", HTMLDivElement);
  private readonly title = element("update-title", HTMLElement);
  private readonly detail = element("update-detail", HTMLSpanElement);
  readonly action = element("update-restart", HTMLButtonElement);
  /** True while the confirmation of a just-applied update is shown. */
  announcing = false;
  show(copy: BannerCopy | undefined): void {
    this.bar.hidden = !copy;
    if (!copy) return;
    this.title.textContent = copy.title;
    this.detail.textContent = copy.detail;
    this.action.textContent = copy.action;
    this.action.hidden = !copy.action;
  }
  announce(state: () => UpdateState): void {
    this.announcing = true;
    this.show({ title: "Retrove updated", detail: `Now running build ${BUILD_ID}.`, action: "OK" });
    window.setTimeout(() => {
      if (this.announcing) this.dismiss(state());
    }, ANNOUNCE_MS);
  }
  dismiss(state: UpdateState): void {
    this.announcing = false;
    this.show(BANNER[state]);
  }
}

function takeUpdatedFrom(): string | undefined {
  try {
    const previous = sessionStorage.getItem(UPDATED_FROM_KEY) ?? undefined;
    sessionStorage.removeItem(UPDATED_FROM_KEY);
    return previous;
  } catch {
    return undefined;
  }
}
function rememberUpdate(): void {
  try {
    sessionStorage.setItem(UPDATED_FROM_KEY, BUILD_ID);
  } catch {
    // Without session storage the update still applies; only the confirmation is skipped.
  }
}

/** Checks for updates in the background and installs them with at most one tap. */
export function connectUpdates(report: (error: unknown) => void): void {
  const status = element("update-status", HTMLSpanElement),
    action = element("update-action", HTMLButtonElement),
    banner = new UpdateBanner();
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
    if (BANNER[next]) banner.announcing = false;
    if (!banner.announcing) banner.show(BANNER[next]);
  };
  if (![undefined, BUILD_ID].includes(takeUpdatedFrom())) banner.announce(() => state);
  const install = async (current: ServiceWorkerRegistration): Promise<void> => {
    show(UpdateState.Applying);
    try {
      await applyUpdate(current);
      rememberUpdate();
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
  banner.action.addEventListener("click", () =>
    banner.announcing ? banner.dismiss(state) : run(),
  );
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
