import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NO_LOCAL_SESSION_NOTE,
  SESSION_BUDGET_NOTE,
  OpenWindowControls,
  ReopenWindowButton,
  SessionCard,
  reopenSessionWindow,
} from "./session-card";
import { getDesktopSessions } from "@/shared/lib/desktop";
import type { SessionGroup } from "../lib/group-thread";
import { pendingMessageId } from "../lib/optimistic-cache";
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

describe("a provisional card (the optimistic request)", () => {
  it("marks the card pending while its opening message is unsaved", () => {
    // The head carries a `pending:` id until the POST answers. The card is the
    // REAL component with the real content — dimmed and inert, not a skeleton
    // and not a lie about a thread that does not exist yet.
    const html = renderToStaticMarkup(
      <SessionCard
        session={session({
          taskId: pendingMessageId("c-1"),
          head: { ...head(), id: pendingMessageId("c-1") },
        })}
        currentUserId={ME}
      />
    );
    // Read off the <article> itself: the status chip's pulse dot carries its
    // own `opacity-60`, so a whole-document match would pass either way.
    const article = html.slice(0, html.indexOf(">") + 1);
    expect(article).toContain('data-pending=""');
    expect(article).toContain("opacity-60");
    expect(article).toContain("pointer-events-none");
    expect(html).toContain("Ship the fix");
  });

  it("leaves a saved card untouched", () => {
    const html = renderToStaticMarkup(
      <SessionCard session={session()} currentUserId={ME} />
    );
    const article = html.slice(0, html.indexOf(">") + 1);
    expect(article).not.toContain("data-pending");
    expect(article).not.toContain("opacity-60");
    expect(article).not.toContain("pointer-events-none");
  });
});

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
  it("calls the bridge with exactly (channelId, threadId) and stays silent on ok", async () => {
    const reopen = vi.fn().mockResolvedValue({ ok: true });
    const note = await reopenSessionWindow({ reopen }, CHANNEL_ID, THREAD_ID);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(reopen).toHaveBeenCalledWith(CHANNEL_ID, THREAD_ID);
    expect(note).toBeNull();
  });

  it("notes ONLY the refusals the operator can act on", async () => {
    // An unreachable channel and a spent window budget each get their own line.
    const unreachable = vi.fn().mockResolvedValue({ ok: false, reason: "no-thread" });
    expect(await reopenSessionWindow({ reopen: unreachable }, CHANNEL_ID, THREAD_ID)).toBe(
      NO_LOCAL_SESSION_NOTE
    );
    const budget = vi.fn().mockResolvedValue({ ok: false, reason: "busy" });
    expect(await reopenSessionWindow({ reopen: budget }, CHANNEL_ID, THREAD_ID)).toBe(
      SESSION_BUDGET_NOTE
    );
    // A bare {ok:false} (an older desktop with no reason) stays QUIET: on this
    // build a thread with no local record opens, so it is not a refusal.
    const bare = vi.fn().mockResolvedValue({ ok: false });
    expect(await reopenSessionWindow({ reopen: bare }, CHANNEL_ID, THREAD_ID)).toBeNull();
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
      <OpenWindowControls busy={false} note={null} onOpen={noop} />
    );
    expect(markup).toContain("Open thread");
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain(NO_LOCAL_SESSION_NOTE);
  });

  it("disables ONLY while an open call is in flight", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy note={null} onOpen={noop} />
    );
    expect(markup).toContain('disabled=""');
  });

  it("shows a refusal note when the desktop gives one", () => {
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy={false} note={NO_LOCAL_SESSION_NOTE} onOpen={noop} />
    );
    // Apostrophe is HTML-escaped in static markup, so assert the stable half.
    expect(markup).toContain("available on this machine");
    // The button stays clickable so the operator can retry.
    expect(markup).toContain("Open thread");
    expect(markup).not.toContain('disabled=""');
  });

  it("renders the note it is GIVEN, not a hardcoded one", () => {
    // The control was rewired from a boolean to a note string; rendering the
    // constant instead of the prop made the budget refusal unreachable and told
    // the operator to fix the wrong thing.
    const markup = renderToStaticMarkup(
      <OpenWindowControls busy={false} note={SESSION_BUDGET_NOTE} onOpen={noop} />
    );
    expect(markup).toContain("Close one and try again");
    expect(markup).not.toContain("available on this machine");
  });

  it("scopes the note to the CHANNEL, not to a missing local session", () => {
    // A thread with no local record now OPENS (the desktop resolves the channel
    // from the API and paints history read-only), so the old machine-scoped
    // copy would be a lie. The note survives only for an unreachable channel.
    expect(NO_LOCAL_SESSION_NOTE).toBe(
      "This channel isn't available on this machine."
    );
    expect(NO_LOCAL_SESSION_NOTE).not.toContain("No live session");
    expect(NO_LOCAL_SESSION_NOTE).not.toContain("no session on this machine");
  });
});

describe("SessionCard render", () => {
  it("renders the card, and the desktop-only reopen button is absent on the server", () => {
    const markup = renderToStaticMarkup(<SessionCard session={session()} />);
    expect(markup).toContain("Ship the fix");
    // The window button is feature-detected after mount, so it never appears in
    // the server / first-paint markup — proving the hydration-safe gating.
    expect(markup).not.toContain("Open thread");
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
      "This thread hit its turn limit. Open the thread to continue."
    );
  });

  it("replaces 'Working…' with the ended note for an active-pinned ended session", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "active", calmEndStatus: "ended" })} />
    );
    expect(markup).not.toContain("Working…");
    expect(markup).toContain(
      "Ended on the desktop. The thread stays open."
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
    expect(markup).not.toContain("Work on this thread was interrupted.");
    // The reply itself starts collapsed (default-collapsed entries) — its
    // author line is present, the body is behind the chevron.
    expect(markup).not.toContain("Here is the answer.");
    expect(markup).toContain('aria-expanded="false"');
  });

  it("starts every entry collapsed, summary or not", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session({
          entries: [
            agentReply(),
            {
              ...agentReply(),
              id: "m3",
              body: "Long body behind a summary",
              metadata: { taskId: THREAD_ID, summary: "One-line summary" },
            },
          ],
        })}
      />
    );
    // Summary-less entry: body hidden, author line shown.
    expect(markup).not.toContain("Here is the answer.");
    // Summary-bearing entry: summary shown, body hidden.
    expect(markup).toContain("One-line summary");
    expect(markup).not.toContain("Long body behind a summary");
    // Both chevrons read collapsed.
    expect(markup).not.toContain('aria-expanded="true"');
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
      "This thread hit its turn limit. Open the thread to continue."
    );
    expect(markup).not.toContain("Working…");
  });

  it("renders an ended run's 'Ended on desktop' chip", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session({ status: "ended" })} />
    );
    expect(markup).toContain("Ended on desktop");
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
 * Whose thread does this card show? A channel runs several threads at once
 * between different pairs, so the footer must not offer the viewer a session on
 * an exchange they are not in: "Open thread" opens a window BOUND to this
 * thread, and the desktop forces the thread tag onto whatever that session
 * posts, so a non-party would only reach a server refusal.
 */
describe("SessionCard thread party", () => {
  const OTHER_PAIR = { createdBy: "u-ada", targetUserId: "u-bo" };

  it("marks the card read-only for a viewer outside the thread's pair", () => {
    const markup = renderToStaticMarkup(
      <SessionCard
        session={session()}
        thread={thread(OTHER_PAIR)}
        currentUserId={ME}
        onCloseThread={async () => {}}
      />
    );
    expect(markup).toContain("Read-only");
    expect(markup).toContain("only its two members can post into it");
    // The close control was already party-gated; the marker states the rule.
    expect(markup).not.toContain("Close thread");
  });

  it("leaves a party's own card unmarked", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session()} thread={thread()} currentUserId={ME} />
    );
    expect(markup).not.toContain("Read-only");
  });

  it("claims nothing for a legacy session with no thread row", () => {
    // No `channel_tasks` row means the parties are unknown, so the card keeps
    // its normal footer rather than guessing in either direction.
    const markup = renderToStaticMarkup(
      <SessionCard session={session()} currentUserId={ME} />
    );
    expect(markup).not.toContain("Read-only");
  });

  it("claims nothing when the viewer is unknown", () => {
    const markup = renderToStaticMarkup(
      <SessionCard session={session()} thread={thread(OTHER_PAIR)} />
    );
    expect(markup).not.toContain("Read-only");
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
