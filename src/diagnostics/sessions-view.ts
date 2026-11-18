import { node } from "../ui/dom";
import { sessionDetail, type SessionDetail } from "./session-detail";
import type { StoredSession } from "./session-store";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DAY_MS = 86_400_000;
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  if (seconds < SECONDS_PER_MINUTE) return `${Math.round(seconds)} s`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.round(seconds / SECONDS_PER_MINUTE)} min`;
  const hours = Math.floor(seconds / SECONDS_PER_HOUR),
    minutes = Math.round((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}
export function formatStart(started: Date | undefined, now = new Date()): string {
  if (!started) return "Unknown time";
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = clock.format(started);
  if (started.getTime() >= midnight) return `Today, ${time}`;
  if (started.getTime() >= midnight - DAY_MS) return `Yesterday, ${time}`;
  return `${day.format(started)}, ${time}`;
}
/** The line under a session: why it stopped, or how it ended. */
function subtitle(detail: SessionDetail, current: boolean): string {
  if (detail.reason) return detail.reason.replace(/^\[\w+\] /u, "");
  if (current && detail.state === "running") return "Running now, or closed without ending";
  return detail.outcome;
}
function row(session: StoredSession, detail: SessionDetail, open: () => void): HTMLLIElement {
  const item = node("li"),
    button = node("button", "session-row");
  button.dataset["state"] = detail.state;
  const text = node("span", "session-text");
  text.append(
    node(
      "strong",
      "",
      [formatStart(detail.started), formatDuration(detail.seconds)].filter(Boolean).join(" · "),
    ),
    node("span", "", subtitle(detail, session.current)),
  );
  button.append(node("span", "session-dot"), text);
  button.addEventListener("click", open);
  item.append(button);
  return item;
}

/** Sessions grouped by app, newest app first; each row opens its detail sheet. */
export function renderSessionGroups(
  container: HTMLElement,
  sessions: readonly StoredSession[],
  open: (session: StoredSession, detail: SessionDetail) => void,
): void {
  const groups = new Map<string, { session: StoredSession; detail: SessionDetail }[]>();
  for (const session of sessions) {
    const detail = sessionDetail(session.text);
    if (!detail) continue;
    const list = groups.get(session.app) ?? [];
    list.push({ session, detail });
    groups.set(session.app, list);
  }
  if (!groups.size) {
    container.replaceChildren(node("p", "group empty-sessions", "No app has run yet."));
    return;
  }
  container.replaceChildren(
    ...[...groups].map(([app, entries]) => {
      const section = node("section", "session-group"),
        heading = node("div", "section-heading");
      heading.append(
        node("h2", "section-title", app),
        node(
          "span",
          "session-count",
          entries.length === 1 ? "1 session" : `${entries.length} sessions`,
        ),
      );
      const list = node("ol", "group session-list");
      list.append(
        ...entries.map(({ session, detail }) => row(session, detail, () => open(session, detail))),
      );
      section.append(heading, list);
      return section;
    }),
  );
}
