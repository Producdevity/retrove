import { parseSession, SESSION_STATES } from "./log-view";
import { UNCLEAN_END } from "./session-store";

export interface TimelineEntry {
  readonly seconds: number;
  readonly label: string;
  readonly problem: boolean;
}
export interface SessionDetail {
  readonly app: string;
  readonly started: Date | undefined;
  readonly seconds: number | undefined;
  /** "failed", "unclean", "running" and so on; `outcome` is its wording. */
  readonly state: string;
  readonly outcome: string;
  readonly reason: string | undefined;
  readonly build: string | undefined;
  readonly reached: string | undefined;
  readonly fps: number | undefined;
  readonly frames: number | undefined;
  readonly timeline: readonly TimelineEntry[];
}
const EVENT = /^\+(?<seconds>[\d.]+)s (?<level>[A-Z]+) \[(?<area>[\w-]+)\] (?<message>.*)$/gmu;
const PHASES: Readonly<Record<string, string>> = {
  "UIKit event loop": "Playing",
  "UIKit delegate launch callbacks": "Starting",
  "UIKit application launch": "Starting",
};
const MILESTONES: readonly { area: string; message: string; label: string }[] = [
  { area: "guest", message: "UIKit application launch", label: "App started" },
  { area: "graphics", message: "First EAGL frame presented", label: "First frame shown" },
  { area: "movie", message: "Opened movie from bundle", label: "Played a video" },
];

/** Player-facing words for a runtime phase. */
export function phaseLabel(phase: string): string {
  return PHASES[phase] ?? phase;
}
function last(pattern: RegExp, text: string): string | undefined {
  let value: string | undefined;
  for (const match of text.matchAll(pattern)) value = match[1];
  return value;
}
function timeline(text: string, unclean: boolean, seconds: number | undefined): TimelineEntry[] {
  const entries: TimelineEntry[] = [],
    seen = new Set<string>();
  let failed = false;
  for (const match of text.matchAll(EVENT)) {
    const groups = match.groups;
    if (!groups) continue;
    const at = Number(groups["seconds"]),
      area = groups["area"] ?? "",
      message = groups["message"] ?? "";
    const milestone = MILESTONES.find((item) => item.area === area && item.message === message);
    if (milestone && !seen.has(milestone.label)) {
      seen.add(milestone.label);
      entries.push({ seconds: at, label: milestone.label, problem: false });
    } else if (groups["level"] === "ERROR" && !failed) {
      failed = true;
      entries.push({ seconds: at, label: `Stopped: ${message}`, problem: true });
    }
  }
  if (unclean)
    entries.push({ seconds: seconds ?? 0, label: "Closed by iOS without warning", problem: true });
  return entries;
}

/** What a stored runtime report says about its session, in words a player can act on. */
export function sessionDetail(report: string): SessionDetail | undefined {
  const unclean = report.startsWith(UNCLEAN_END),
    text = unclean ? report.slice(UNCLEAN_END.length) : report,
    summary = parseSession(text);
  if (!summary) return undefined;
  const state = unclean ? "unclean" : summary.state,
    phase = last(/"phase": "([^"]+)"/gu, text),
    fps = last(/"fps": ([\d.]+)/gu, text),
    frames = last(/"presentedFrames": (\d+)/gu, text);
  return {
    app: summary.app,
    started: summary.started,
    seconds: summary.seconds,
    state,
    outcome: SESSION_STATES[state] ?? state,
    reason:
      summary.firstError ??
      (unclean
        ? "iOS closed Retrove while this game ran, most likely for using too much memory."
        : undefined),
    build: last(/"build": "retrove-([0-9a-f]+)"/gu, text),
    reached: phase === undefined ? undefined : (PHASES[phase] ?? phase),
    fps: fps === undefined ? undefined : Number(fps),
    frames: frames === undefined ? undefined : Number(frames),
    timeline: timeline(text, unclean, summary.seconds),
  };
}
