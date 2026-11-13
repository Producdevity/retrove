import "./player.css";
import { openIPA } from "../../web/ipa.mjs";
import { Platform, type ApplicationId } from "../domain/application";
import { errorMessage } from "../domain/validation";
import { browserLibrary } from "../library/browser";
import { action, element } from "../ui/dom";
import { PlayerDisplay } from "./display";
import { SessionReport } from "./report";
import { PlayerSession } from "./session";

const status = element("status", HTMLHeadingElement);
const detail = element("detail", HTMLParagraphElement);
const start = element("start", HTMLButtonElement);
const media = element("resume-media", HTMLButtonElement);
let session: PlayerSession | undefined;
let imageVisible = false;
const fail = (error: unknown): void => {
  document.body.classList.remove("playing");
  document.body.classList.add("failed");
  status.textContent = errorMessage(error);
  detail.textContent = "Open the report for details, or return to your library.";
  start.hidden = true;
};
const showImage = (): void => {
  imageVisible = true;
  document.body.classList.add("playing");
};
const report = new SessionReport(
  (state) => {
    if (state.fault) fail(new Error(state.fault));
    else if (state.frames > 0) showImage();
  },
  (level, area, message) => {
    if (level === "info") {
      detail.textContent = message;
      if (!imageVisible) status.textContent = message;
    }
    if (area === "movie" && message.includes("Tap")) media.hidden = false;
  },
);
const display = new PlayerDisplay((error) => {
  session?.abort(error);
  fail(error);
}, showImage);
const library = browserLibrary(fail);
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
  document.title = `${app.name} — Retrove`;
  report.start(app.name);
  const archive = await openIPA(await library.open(app), report.diagnostic);
  display.configure(archive.info);
  session = new PlayerSession(library, app, archive, display, report);
  status.textContent = `Ready to open ${app.name}`;
  detail.textContent = "Tap Start to enable audio and launch the app.";
  start.hidden = false;
}
start.addEventListener(
  "click",
  action(
    async () => {
      if (!session) return;
      start.hidden = true;
      await session.start();
    },
    (error) => {
      fail(error);
      report.show();
    },
  ),
);
media.addEventListener(
  "click",
  action(async () => {
    await session?.resumeMedia();
    media.hidden = true;
  }, fail),
);
element("back", HTMLAnchorElement).addEventListener("click", (event) => {
  event.preventDefault();
  void (async () => {
    await session?.stop();
    report.store();
    location.assign("/");
  })().catch((error) => {
    fail(error);
    report.show();
  });
});
window.addEventListener("pagehide", () => {
  session?.abort();
  report.store();
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
