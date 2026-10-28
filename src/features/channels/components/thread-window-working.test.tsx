// @vitest-environment jsdom
/**
 * 🔴 **THE POP-OUT THREAD WINDOW SHOWS MY OWN AGENTS MID-TURN — IT DREW NONE, AND THE
 * PROP WAS SIMPLY NEVER THREADED** (release review, 2026-10-11).
 *
 * ⚠ **IT IS NOT A PROVIDER PROBLEM AND NOT A COMPONENT BUG, WHICH IS WHY NO EXISTING
 * SUITE CAUGHT IT.** `message-pane.tsx` has taken `agentActivity?: ReactNode` and fed it
 * to `ComposerRecipients`'s `working=` slot since the strip landed; `agent-activity.tsx`
 * draws it and has its own suite; `composer-recipients-working.test.tsx` pins that the
 * strip survives an unaddressed draft (#3166). Every part worked. **One of the two hosts
 * never passed the prop** — and the host that forgot is the window dedicated to ONE
 * exchange, i.e. the surface where "is my agent answering this?" is the whole question.
 * `grep agentActivity` across `thread-window.test.tsx`, `message-pane.test.tsx` and
 * `pop-out.test.tsx` returned nothing before this file.
 *
 * ⚠ **THE SEAM UNDER TEST IS `thread-window → message-pane → the composer's `working`
 * slot`.** The composer is mocked to RENDER what it is handed rather than to swallow it
 * (`thread-window.test.tsx` mocks it to a bare div, which is exactly why a missing prop
 * was invisible there) — it is a write surface with its own mutation stack and its own
 * suite, and what is under test here is the wiring plus the real strip.
 *
 * ⚠ **A NEW FILE, NOT A SECTION IN `thread-window.test.tsx`**, because that file's whole
 * subject is the window's ABSENCES — no sidebar, no tree, no info panel — and it mocks
 * the composer away to assert them. This one needs the composer's slot rendered, which is
 * the opposite harness.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { CHANNEL_ID, ME, PEER, member, message, thread, WS } from "./test-fixtures";

const THREAD = thread({ id: "t-1", title: "Ship the release" });
/** The OTHER thread in this channel — the scoping assertion's whole point. */
const OTHER_THREAD_ID = "t-2";

vi.mock("./live", () => ({ useChannelsLive: () => ({ gate: {} }) }));

/** ⚠ IT RENDERS `working`, deliberately: a mock that drops the node cannot tell a
 *  threaded prop from an omitted one, which is how this shipped. */
vi.mock("./composer", () => ({
  ChannelsComposer: ({ working }: { working?: ReactNode }) => (
    <div data-testid="composer">{working}</div>
  ),
}));

vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [
      message({ id: "m-1", seq: 1, authorUserId: PEER, body: "in the thread", metadata: { threadId: "t-1" } }),
    ],
    loading: false,
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-members", () => ({
  useChannelMembers: () => ({
    members: [member({ userId: ME }), member({ userId: PEER, role: "member" })],
    refetch: () => {},
  }),
}));
vi.mock("../hooks/use-channel-threads", () => ({
  useChannelThreads: () => ({ threads: [THREAD], loading: false, truncated: false, refetch: () => {} }),
}));
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [] }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: () => {}, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));
vi.mock("../hooks/use-channel-agent-sessions", () => ({
  useChannelAgentSessions: () => ({ sessions: [], refetch: () => {} }),
}));

/** THIS MACHINE'S OWN FEED — `null` is "could not ask" (a plain browser), `[]` is
 *  "asked, nothing is running", and the two may never collapse (INVARIANTS §11). */
const { ownSessions } = vi.hoisted(() => ({
  ownSessions: vi.fn((): unknown[] | null => []),
}));
vi.mock("./use-desktop-sessions", () => ({
  useDesktopSessions: () => ({ sessions: ownSessions(), refresh: () => {} }),
}));

import { ChannelsThreadWindow } from "./thread-window";

afterEach(() => {
  cleanup();
  ownSessions.mockReturnValue([]);
});

/** One row of the desktop feed. `name` IS the agent id on this feed; `displayName` is the
 *  operator's own rename, which `agentDisplayName` prefers. */
function ownAgent(over: Record<string, unknown> = {}) {
  return {
    sessionId: "s-1",
    channelId: CHANNEL_ID,
    threadId: THREAD.id,
    agentId: "a1b2c3d4",
    name: "a1b2c3d4",
    displayName: "Picker Fix",
    state: "working",
    channelName: "Website",
    color: "agent-03",
    ...over,
  };
}

function openWindow() {
  return render(
    <ChannelsThreadWindow
      workspaceId={WS}
      channelId={CHANNEL_ID}
      threadId={THREAD.id}
      currentUserId={ME}
    />
  );
}

/**
 * The strip's pill for our agent, or `null`.
 *
 * ⚠ **QUERIED BY TEXT AND THEN WALKED UP TO THE `role="status"`, not by accessible NAME.**
 * `status` is a live-region role and is NOT name-from-content, so `getByRole("status", {
 * name })` matches nothing even when the pill is on screen — which would make every
 * assertion below pass or fail for the wrong reason.
 */
function workingPill(): HTMLElement | null {
  const face = screen.queryByText("Picker Fix");
  return face ? (face.closest('[role="status"]') as HTMLElement | null) : null;
}

describe("the pop-out's working strip", () => {
  it("names MY agent working on this thread, in a role=status pill", () => {
    ownSessions.mockReturnValue([ownAgent()]);
    openWindow();
    // 🔒 THE PROPERTY: the window says an agent of mine is answering THIS exchange.
    const pill = workingPill();
    expect(pill).not.toBeNull();
    // Inside the composer's own slot, which is where the recipient line draws it.
    expect(pill?.closest("[data-testid='composer']")).not.toBeNull();
  });

  it("paints the pill with that agent's own colour, resolved by this host", () => {
    // ⚠ MIRRORED FROM `channel-surface.tsx`: `lib/agent-colors.ts › agentColorVar` is the
    // one place a key becomes a `var()`, so one agent cannot wear two hues across the two
    // windows. The KEY never reaches the component.
    ownSessions.mockReturnValue([ownAgent()]);
    openWindow();
    expect(workingPill()?.getAttribute("style")).toContain("--agent-color-03");
  });

  it("keeps the black face for an agent the live set published no colour for", () => {
    // A room with all sixteen keys out is a real state, not a failure — the component owns
    // what "no colour" looks like, and the host must not invent a fallback.
    ownSessions.mockReturnValue([ownAgent({ color: null })]);
    openWindow();
    const pill = workingPill();
    expect(pill?.getAttribute("style")).toBeNull();
    expect(pill?.className).toContain("bg-surface-cta");
  });

  it("is SCOPED TO THIS THREAD — an agent working on another one is not reported here", () => {
    // A pop-out is ONE exchange by construction, so a channel-wide strip here would report
    // an agent working somewhere this reader cannot see.
    ownSessions.mockReturnValue([ownAgent({ threadId: OTHER_THREAD_ID })]);
    openWindow();
    expect(workingPill()).toBeNull();
  });

  it("draws nothing for an IDLE agent, and nothing when the feed says 'could not ask'", () => {
    ownSessions.mockReturnValue([ownAgent({ state: "idle" })]);
    openWindow();
    expect(workingPill()).toBeNull();
    cleanup();
    // `null` is a plain browser: nothing to report and nothing claimed (INVARIANTS §11).
    ownSessions.mockReturnValue(null);
    openWindow();
    expect(screen.getByTestId("composer")).toBeTruthy();
    expect(workingPill()).toBeNull();
  });
});
