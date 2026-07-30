import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NO_LOCAL_SESSION_NOTE,
  OpenWindowControls,
  ReopenWindowButton,
  SessionCard,
  reopenSessionWindow,
} from "./session-card";
import { getDesktopSessions } from "@/shared/lib/desktop";
import type { SessionGroup } from "../lib/group-thread";
import type { ChannelMessage, ChannelTask } from "../types";

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "task-11111111-1111-4111-8111-111111111111-7";

function head(): ChannelMessage {
  return {
    id: "m1",
    seq: 7,
    channelId: CHANNEL_ID,
    authorUserId: "u-agent",
    authorKind: "agent",
    kind: "task_started",
    body: "Started working",
    metadata: { taskId: TASK_ID },
    clientMsgId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  };
}

function session(over: Partial<SessionGroup> = {}): SessionGroup {
  return {
    taskId: TASK_ID,
    status: "active",
    title: "Ship the fix",
    mode: null,
    head: head(),
    entries: [],
    summary: "Ship the fix",
    outcomeSummary: null,
    calmEndStatus: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    ...over,
  };
}

const ME = "u-me";

/** The authoritative task row for this session, owned by the viewer. */
function task(over: Partial<ChannelTask> = {}): ChannelTask {
  return {
    id: TASK_ID,
    channelId: CHANNEL_ID,
    workspaceId: "w1",
    title: "Ship the fix",
    status: "open",
    outcome: null,
    mode: "interactive",
    createdBy: ME,
    targetUserId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    closedAt: null,
    outcomeSummary: null,
    ...over,
  };
}

/** A delivered agent reply entry, for the "reply suppresses the line" cases. */
function agentReply(): ChannelMessage {
  return {
    id: "r1",
    seq: 9,
    channelId: CHANNEL_ID,
    authorUserId: "u-agent",
    authorKind: "agent",
    kind: "message",
    body: "Here is the answer.",
    metadata: { taskId: TASK_ID },
    clientMsgId: null,
    createdAt: "2026-07-28T00:01:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  };
}

// Each test that defines `window` cleans it up so the server-render tests see
// the true "no bridge on the server" state (getDesktopSessions -> null).
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("getDesktopSessions gate (the reopen button's visibility source)", () => {
  it("returns the bridge only when window.dopl.sessions.reopen is a function", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { sessions: { reopen: vi.fn() } },
    };
    expect(getDesktopSessions()).not.toBeNull();
  });

  it("returns null in a plain browser (no window.dopl)", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(getDesktopSessions()).toBeNull();
  });

  it("returns null on an older desktop build (marker but no sessions API)", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { isDesktop: true },
    };
    expect(getDesktopSessions()).toBeNull();
  });
});

describe("reopenSessionWindow (the click action)", () => {
  it("calls the bridge with exactly (channelId, taskId) and maps ok:true", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, TASK_ID);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, TASK_ID);
    expect(ok).toBe(true);
  });

  it("maps a genuine {ok:false} (no record on this machine) to the note path", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: false });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, TASK_ID);
    expect(ok).toBe(false);
  });
});

describe("ReopenWindowButton render gating", () => {
  it("renders nothing on the server / plain browser (no bridge)", () => {
    const markup = renderToStaticMarkup(
      <ReopenWindowButton channelId={CHANNEL_ID} taskId={TASK_ID} />
    );
    expect(markup).toBe("");
  });
});

/**
 * The window control is always available once the bridge exists: it takes no
 * session or task status, so nothing but an in-flight open can disable it.
 */
describe("OpenWindowControls", () => {
  const noop = () => {};

  it("renders an ENABLED button with no note at rest", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy={false} noLocalSession={false} onOpen={noop} />
    );
    expect(markup).toContain("Open window");
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain(NO_LOCAL_SESSION_NOTE);
  });

  it("disables ONLY while an open call is in flight", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy noLocalSession={false} onOpen={noop} />
    );
    expect(markup).toContain('disabled=""');
  });

  it("shows the machine-scoped note after a genuine {ok:false}", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy={false} noLocalSession onOpen={noop} />
    );
    expect(markup).toContain("This task has no session on this machine.");
    // The button stays clickable so the operator can retry.
    expect(markup).toContain("Open window");
    expect(markup).not.toContain('disabled=""');
  });

  it("retires the old live-session-only copy", () => {
    expect(NO_LOCAL_SESSION_NOTE).toBe("This task has no session on this machine.");
    expect(NO_LOCAL_SESSION_NOTE).not.toContain("No live session");
  });
});

describe("SessionCard render", () => {
  it("renders the card, and the desktop-only reopen button is absent on the server", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Ship the fix");
    // The window button is feature-detected after mount, so it never appears in
    // the server / first-paint markup — proving the hydration-safe gating.
    expect(markup).not.toContain("Open window");
  });

  it("shows the plain 'Working…' line for an active session with no reply and no calm end", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Working…");
  });

  it("replaces 'Working…' with the capped note when an open-task overlay pins status active", () => {
    // The task row is still open (overlay -> status "active"), but a turn-cap
    // task_failed landed with no restart: the card must not keep claiming work.
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active", calmEndStatus: "capped" })} />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).toContain(
      "The session hit its turn limit. Reopen the window to continue."
    );
  });

  it("replaces 'Working…' with the ended note for an active-pinned ended session", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active", calmEndStatus: "ended" })} />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).toContain(
      "The session was ended on the desktop. The task stays open."
    );
  });

  it("keeps 'Working…' suppressed entirely once an agent reply arrived (calm end ignored)", () => {
    // An agent reply suppresses the line via showWorking; the calm-end note must
    // not resurrect it.
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session({
          status: "active",
          calmEndStatus: "interrupted",
          entries: [agentReply()],
        })}
      />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).not.toContain("The session was interrupted.");
    expect(markup).toContain("Here is the answer.");
  });

  it("renders a capped session's muted status chip and body note (no overlay case)", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "capped", summary: "Turn limit reached" })} />
    );
    // Calm chip label + calm dot (muted, never the danger red).
    expect(markup).toContain("Limit reached");
    expect(markup).toContain("bg-text-disabled");
    expect(markup).not.toContain("bg-danger");
    // The terminal note (no reply delivered) explains the calm ending.
    expect(markup).toContain(
      "The session hit its turn limit. Reopen the window to continue."
    );
    expect(markup).not.toContain("Working…");
  });

  it("renders an ended session's 'Session ended' chip", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "ended" })} />
    );
    expect(markup).toContain("Session ended");
    expect(markup).toContain("bg-text-disabled");
  });
});

/**
 * Task controls on the card: Close only. Reopen was removed from the card in
 * v2.5 (it lives in the task panel), so a closed task's footer carries no task
 * mutation at all.
 */
describe("SessionCard task controls", () => {
  const closeTask = async () => {};

  it("keeps the Close affordance for an open task the viewer manages", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session()}
        task={task()}
        currentUserId={ME}
        onCloseTask={closeTask}
      />
    );
    expect(markup).toContain("Close task");
  });

  it("offers NO reopen control for a closed task the viewer manages", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session({ status: "done" })}
        task={task({
          status: "closed",
          outcome: "completed",
          closedAt: "2026-07-28T00:05:00.000Z",
        })}
        currentUserId={ME}
        onCloseTask={closeTask}
      />
    );
    expect(markup).not.toContain("Reopen task");
    expect(markup).not.toContain("Close task");
  });
});

/**
 * The card container is always neutral; status is the chip's job. The green
 * active treatment shipped in v2.4 and was removed same day by product call.
 */
describe("SessionCard container treatment", () => {
  it("keeps the neutral container for every status, active included", () => {
    for (const status of [
      "active", "done", "failed", "declined", "dropped", "interrupted", "capped", "ended",
    ] as const) {
      const markup = renderToStaticMarkup(<SessionCard session={session({ status })} />);
      expect(markup).toContain("border-border-default");
      expect(markup).toContain("bg-bg-elevated");
      expect(markup).not.toContain("bg-success/10");
      expect(markup).not.toContain("border-success/25");
    }
  });

  it("never paints the container amber (that is the consent card's color)", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active" })} />
    );
    expect(markup).not.toContain("bg-warning/10");
  });

  it("still composes the transient nav highlight ring over the neutral container", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active" })} highlighted />
    );
    expect(markup).toContain("bg-bg-elevated");
    expect(markup).toContain("ring-border-highlight");
  });
});
