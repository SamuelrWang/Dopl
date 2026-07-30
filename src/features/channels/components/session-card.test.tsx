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
import type { ChannelMessage, ChannelThread } from "../types";

const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "task-11111111-1111-4111-8111-111111111111-7";

function head(): ChannelMessage {
  return {
    id: "m1",
    seq: 7,
    channelId: CHANNEL_ID,
    authorUserId: "u-agent",
    authorKind: "agent",
    kind: "task_started",
    body: "Started working",
    metadata: { taskId: THREAD_ID },
    clientMsgId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  };
}

function session(over: Partial<SessionGroup> = {}): SessionGroup {
  return {
    taskId: THREAD_ID,
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

/** The authoritative thread row for this session, owned by the viewer. */
function thread(over: Partial<ChannelThread> = {}): ChannelThread {
  return {
    id: THREAD_ID,
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
    metadata: { taskId: THREAD_ID },
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
  it("calls the bridge with exactly (channelId, threadId) and maps ok:true", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, THREAD_ID);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, THREAD_ID);
    expect(ok).toBe(true);
  });

  it("maps a genuine {ok:false} (no record on this machine) to the note path", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: false });
    const ok = await reopenSessionWindow({ reopen }, CHANNEL_ID, THREAD_ID);
    expect(ok).toBe(false);
  });
});

describe("ReopenWindowButton render gating", () => {
  it("renders nothing on the server / plain browser (no bridge)", () => {
    const markup = renderToStaticMarkup(
      <ReopenWindowButton channelId={CHANNEL_ID} threadId={THREAD_ID} />
    );
    expect(markup).toBe("");
  });
});

/**
 * The window control is always available once the bridge exists: it takes no
 * session or thread status, so nothing but an in-flight open can disable it.
 */
describe("OpenWindowControls", () => {
  const noop = () => {};

  it("renders an ENABLED button with no note at rest", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy={false} noLocalSession={false} onOpen={noop} />
    );
    expect(markup).toContain("Open session");
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
    expect(markup).toContain("This thread has no session on this machine.");
    // The button stays clickable so the operator can retry.
    expect(markup).toContain("Open session");
    expect(markup).not.toContain('disabled=""');
  });

  it("retires the old live-session-only copy", () => {
    expect(NO_LOCAL_SESSION_NOTE).toBe(
      "This thread has no session on this machine."
    );
    expect(NO_LOCAL_SESSION_NOTE).not.toContain("No live session");
  });
});

describe("SessionCard render", () => {
  it("renders the card, and the desktop-only reopen button is absent on the server", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Ship the fix");
    // The window button is feature-detected after mount, so it never appears in
    // the server / first-paint markup — proving the hydration-safe gating.
    expect(markup).not.toContain("Open session");
  });

  it("shows the plain 'Working…' line for an active session with no reply and no calm end", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Working…");
  });

  it("replaces 'Working…' with the capped note when an open-thread overlay pins status active", () => {
    // The thread row is still open (overlay -> status "active"), but a turn-cap
    // task_failed landed with no restart: the card must not keep claiming work.
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active", calmEndStatus: "capped" })} />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).toContain(
      "The session hit its turn limit. Open the session to continue."
    );
  });

  it("replaces 'Working…' with the ended note for an active-pinned ended session", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active", calmEndStatus: "ended" })} />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).toContain(
      "The session was ended on the desktop. The thread stays open."
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
      "The session hit its turn limit. Open the session to continue."
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
 * Thread controls on the card: Close only. Reopen was removed from the card in
 * v2.5 (it lives in the thread panel), so a closed thread's footer carries no thread
 * mutation at all.
 */
describe("SessionCard thread controls", () => {
  const closeThread = async () => {};

  it("keeps the Close affordance for an open thread the viewer manages", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session()}
        thread={thread()}
        currentUserId={ME}
        onCloseThread={closeThread}
      />
    );
    expect(markup).toContain("Close thread");
  });

  it("offers NO reopen control for a closed thread the viewer manages", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session({ status: "done" })}
        thread={thread({
          status: "closed",
          outcome: "completed",
          closedAt: "2026-07-28T00:05:00.000Z",
        })}
        currentUserId={ME}
        onCloseThread={closeThread}
      />
    );
    expect(markup).not.toContain("Reopen thread");
    expect(markup).not.toContain("Close thread");
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
