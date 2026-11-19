import "../ui/appearance.css";
import "./player.css";
import { MOTION_ACCESS_REQUESTED, requestMotionAccess } from "../runtime/ios/uikit/motion/access";
import { initializeAppearance } from "../ui/appearance";
import "../runtime/ios/uikit/alerts/dialog.css";
import { openIPA } from "../../web/ipa.mjs";
import { Platform, type ApplicationId } from "../domain/application";
import { errorMessage } from "../domain/validation";
import { browserLibrary } from "../library/browser";
import { action, element } from "../ui/dom";
import { onUserActivation } from "./activation";
import { BootSequence } from "./boot/sequence";
import { PlayerDisplay } from "./display";
import { SessionReport } from "./report";
import { connectOrientation } from "./orientation";
import { appProfile } from "../runtime/ios/profiles/app-manifest";
import { isLandscape } from "../runtime/ios/uikit/screen";

import { PlayerSession } from "./session";
import { DebugOverlay } from "./debug-overlay";

initializeAppearance();
const LOADER_AREAS = new Set(["ipa", "guest"]);
const status = element("status", HTMLHeadingElement);
const detail = element("detail", HTMLParagraphElement);
const tapHint = element("tap-hint", HTMLParagraphElement);
const loading = element("loading", HTMLDivElement);
const tile = loading.querySelector("canvas");
const steps = loading.querySelector(".boot-steps");
if (!tile || !(steps instanceof HTMLElement)) throw new Error("Missing loading interface.");
const boot = new BootSequence(tile, steps, status, detail);
let motionPending = false;
window.addEventListener(MOTION_ACCESS_REQUESTED, () => {
  motionPending = true;
});
const overlay = new DebugOverlay(
  element("debug-overlay", HTMLPreElement),
  element("debug-toggle", HTMLButtonElement),
);
let session: PlayerSession | undefined;
let imageVisible = false;
let audioResumeNeeded = false;
let movieResumeNeeded = false;
const updateMedia = (): void => {
  tapHint.hidden = !movieResumeNeeded;
};
onUserActivation(
  window,
  () => {
    const tasks: Promise<unknown>[] = [];
    if (motionPending) {
      motionPending = false;
      tasks.push(requestMotionAccess());
    }
    if (session && (audioResumeNeeded || movieResumeNeeded)) tasks.push(session.resumeMedia());
    return tasks;
  },
  (error) => report.diagnostic("warn", "activation", errorMessage(error)),
);
const fail = (error: unknown): void => {
  boot.stop();
  document.body.classList.remove("playing");
  document.body.classList.add("failed");
  status.textContent = errorMessage(error);
  detail.textContent = "Open the report for details, or return to your library.";
};
const showImage = (): void => {
  if (imageVisible) return;
  imageVisible = true;
  void boot.finish(display.host, loading).finally(() => document.body.classList.add("playing"));
};
const report = new SessionReport(
  (state) => {
    if (state.fault) fail(new Error(state.fault));
    else if (state.frames > 0) showImage();
  },
  (level, area, message, details) => {
    overlay.record({ level, area, message });
    if (level !== "info" || !LOADER_AREAS.has(area) || imageVisible) return;
    if (!boot.signal(area, message, details)) detail.textContent = message;
  },
);
const display = new PlayerDisplay(
  (error) => {
    session?.abort(error);
    fail(error);
  },
  showImage,
  report.diagnostic,
);
const { library } = browserLibrary(fail);
function isIosId(value: string | null): value is ApplicationId {
  return (
    value !== null &&
    value.startsWith(`${Platform.IOS}:`) &&
    value.length > Platform.IOS.length + 1 &&
    !value.includes("\0")
  );
}
async function prepare(): Promise<void> {
  const id = new URL(location.href).searchParams.get("app");
  if (!isIosId(id)) throw new Error("Choose an iOS app from your library.");
  const app = await library.get(id);
  if (!app) throw new Error("This app is no longer in your library.");
  element("title", HTMLSpanElement).textContent = app.name;
  boot.setIcon(app.icon);
  status.textContent = `Opening ${app.name}`;
  document.title = `${app.name} — Retrove`;
  report.start(app.name);
  const archive = await openIPA(await library.open(app), report.diagnostic);
  connectOrientation(id, isLandscape(appProfile(archive.info).orientation));
  display.configure(archive.info);
  session = new PlayerSession(library, app, archive, display, report, {
    audio: (needed) => {
      audioResumeNeeded = needed;
      updateMedia();
    },
    movie: (needed) => {
      movieResumeNeeded = needed;
      updateMedia();
    },
  });
  await session.start();
  boot.stop();
  document.body.classList.add("finished");
  status.textContent = "App closed";
  detail.textContent = "";
}
element("back", HTMLAnchorElement).addEventListener("click", (event) => {
  event.preventDefault();
  void (async () => {
    await session?.stop();
    report.store();
    // Replacing keeps the player out of history, so iOS has no page to swipe back or forward to.
    location.replace("/");
  })().catch((error) => {
    fail(error);
    report.show();
  });
});
window.addEventListener("pagehide", () => {
  session?.abort();
  report.store();
});
const LEAVE_CONFIRM_MS = 3000;
const back = element("back", HTMLAnchorElement),
  backLabel = back.querySelector(".control-label");
let leaveArmed = 0;
back.addEventListener("click", (event) => {
  if (leaveArmed) return;
  event.preventDefault();
  back.classList.add("armed");
  if (backLabel) backLabel.textContent = "Tap again to leave";
  leaveArmed = window.setTimeout(() => {
    leaveArmed = 0;
    back.classList.remove("armed");
    if (backLabel) backLabel.textContent = "Library";
  }, LEAVE_CONFIRM_MS);
});
const toolbarToggle = element("show-toolbar", HTMLButtonElement);
element("fullscreen", HTMLButtonElement).addEventListener(
  "click",
  action(async () => {
    document.body.classList.add("immersive");
    toolbarToggle.hidden = false;
    if (document.fullscreenEnabled) await document.documentElement.requestFullscreen();
  }, fail),
);
toolbarToggle.addEventListener("click", () => {
  document.body.classList.remove("immersive");
  toolbarToggle.hidden = true;
});
const stage = element("stage", HTMLElement);
for (const name of ["gesturestart", "gesturechange", "gestureend", "touchmove", "contextmenu"])
  stage.addEventListener(name, (event) => event.preventDefault(), { passive: false });
void prepare().catch(fail);
