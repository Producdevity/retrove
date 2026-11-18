import { describe, expect, it } from "vite-plus/test";
import { sessionDetail } from "./session-detail";
import { UNCLEAN_END } from "./session-store";

const REPORT = `Retrove runtime diagnostics
Run: 1-a
Input: Cut the Rope
Started: 2026-11-18T01:33:54.870Z
Last checkpoint: 2026-11-18T01:34:34.878Z
State: failed (+40.007s)
First error: [guest] Uninitialized NSTimeZone receiver.
Environment and input
{
  "build": "retrove-c6304d8"
}

Events (3)
+0.193s INFO [guest] UIKit application launch
+0.984s INFO [graphics] First EAGL frame presented
+39.995s ERROR [guest] Uninitialized NSTimeZone receiver.
+40.007s ERROR [session] Uninitialized NSTimeZone receiver.

Latest runtime snapshot
{
  "phase": "UIKit event loop",
  "render": { "presentedFrames": 1293 },
  "frameTimings": { "fps": 38.1 }
}
`;

describe("session detail", () => {
  it("summarises a failed session", () => {
    const detail = sessionDetail(REPORT);
    expect(detail).toMatchObject({
      app: "Cut the Rope",
      state: "failed",
      outcome: "Failed",
      reason: "[guest] Uninitialized NSTimeZone receiver.",
      build: "c6304d8",
      reached: "Playing",
      fps: 38.1,
      frames: 1293,
    });
    expect(detail?.timeline.map((entry) => entry.label)).toEqual([
      "App started",
      "First frame shown",
      "Stopped: Uninitialized NSTimeZone receiver.",
    ]);
  });
  it("explains a session iOS closed", () => {
    const detail = sessionDetail(
      `${UNCLEAN_END}\n\n${REPORT.replace("State: failed", "State: running")
        .replace(/^First error.*\n/mu, "")
        .replace(/^\+3\d\.\d+s ERROR.*\n/gmu, "")}`,
    );
    expect(detail?.state).toBe("unclean");
    expect(detail?.reason).toContain("memory");
    expect(detail?.timeline.at(-1)?.label).toBe("Closed by iOS without warning");
  });
});
