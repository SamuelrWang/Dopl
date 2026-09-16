// @vitest-environment jsdom
/**
 * 🔒 **THE AGENT POP-OUT'S ENDED FACE — one black pill on the THREAD LINE, and nothing in the
 * corner** (Samuel, 2026-09-15, in two steps the same day: *"On the top right you see the 'Ended'
 * badge. I don't want the badges to be there. … 'Ended by you' should be the badge"*, then, on
 * seeing it at the foot: *"Instead of putting the ended badge on the bottom left, put it on the
 * right of the line where it says 'in main channel'. Similarly, for where you see 'running',
 * 'thinking', or 'working' (all of those little things), put that in the same spot … but to the
 * right, aligned to the right."*).
 *
 * ⚠ **THE FOOTER THE FIRST STEP BUILT IS DELETED, NOT HIDDEN** — one marker, one place. What both
 * steps agree on, and what this file is really about, is that the chrome's top-right corner says
 * nothing about an agent.
 *
 * ⚠ **§1 SPLIT OUT OF `agent-window.test.tsx`**, which was at the 500-line cap when this ruling
 * landed. The seam is real rather than arithmetic: this file moves when what the window says about
 * a DEAD agent moves, and that file moves when the live lanes do.
 *
 * ⚠ **THE WORDS ARE MAIN'S AND THE ROW THEY CAME FROM IS GONE.** `main/session-narration.js ›
 * noteEnded` pushes one `status` frame worded by `main/session-effects.js › endedStatusText`; it
 * rendered as the last muted line of the log. Leaving it there AND adding a pill would be one fact
 * twice — the defect `agent-bits.tsx` opens with — so the window lifts it out
 * (`agent-stream-lanes.ts › splitEndNote`).
 *
 * ⚠ **THE OTHER HALF OF THE MOVE IS PINNED IN `agent-ended.test.tsx`**, over the page source: the
 * chrome's status slot no longer builds a pill for an ended agent.
 *
 * ⚠ **THE `vi.mock` BLOCK IS DUPLICATED FROM THE SIBLING SUITE ON PURPOSE** — those calls are
 * hoisted per FILE and their factories cannot close over an import, which is the same reason
 * `agent-window-harness.tsx` holds only what a plain function can hold.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { installBridge, mount, summary } from "./agent-window-harness";

const { live, refetchMessages, refetchPending, consentMutate } = vi.hoisted(() => ({
  live: vi.fn<
    (opts: {
      workspaceId: string;
      refetchAll: () => void;
      refetchMembers: () => void;
    }) => { gate: object }
  >(() => ({ gate: {} })),
  refetchMessages: vi.fn(),
  refetchPending: vi.fn(),
  consentMutate: vi.fn(),
}));

// The transcript read is a real hook; this suite is about the window's own lanes.
vi.mock("../hooks/use-channel-messages", () => ({
  useChannelMessages: () => ({
    messages: [],
    loading: false,
    refetch: refetchMessages,
  }),
}));

// The realtime registration is asserted, not exercised — `live.ts` owns the
// subscription and has its own coverage.
vi.mock("./live", () => ({ useChannelsLive: live }));

// ⚠ THE WINDOW READS AND WRITES CONSENT SINCE 2026-08-25 (Samuel's outbound-review
// ruling): the work stream's held-draft card is decidable here. Both are real
// hooks over TanStack + the API, and this suite mounts with no QueryClient — the
// card's own behaviour is `agent-stream.test.tsx`'s, over the pure model.
vi.mock("../hooks/use-consent-inbox", () => ({
  useConsentInbox: () => ({ requests: [], outbound: [], refetch: refetchPending }),
}));
vi.mock("../hooks/use-channel-preference-writes", () => ({
  useChannelPreferenceWrites: () => ({
    consent: { mutate: consentMutate, pending: false },
    unaddressedResponder: { mutate: () => {}, pending: false },
  }),
}));

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
});

/**
 * 🔒 **THE END IS ONE BLACK PILL AT THE FOOT, AND NOWHERE ELSE** (Samuel, 2026-09-15: *"On the top
 * right you see the 'Ended' badge. I don't want the badges to be there. I want that 'Ended' badge
 * instead to be on the bottom left. You see 'Ended by you.' Have 'Ended by you' be that black
 * badge, right? … Instead, the badge would be right there. That's going to free up some space."*).
 *
 * ⚠ **THE WORDS ARE MAIN'S AND THE ROW THEY CAME FROM IS GONE.** `main/session-narration.js ›
 * noteEnded` pushes one `status` frame worded by `main/session-effects.js › endedStatusText`; it
 * used to render as the last muted line of the log. Leaving it there AND adding a pill would be
 * one fact twice — the defect `agent-bits.tsx` opens with — so the window lifts it out
 * (`agent-stream-lanes.ts › splitEndNote`).
 *
 * 🔒 MUTATION-PROOF: drop `AgentEndedFooter` and the first case fails; drop `splitEndNote` and the
 * sentence comes back as a log row beside the pill; drop the `ended` gate and the third fails.
 */
describe("an ended agent wears its end as the thread line's badge", () => {
  const ENDED_NOTE = "Ended by you";

  it("shows main's own sentence in the pill, and not in the log", async () => {
    installBridge({
      sessions: [summary({ state: "ended" })],
      entries: [
        { at: 1, kind: "assistant", text: "all done" },
        { at: 2, kind: "status", text: ENDED_NOTE },
      ],
    });
    await mount();
    // ⚠ THE FACE BY ITS CLASSES, because "is it a badge" is the whole ruling and jsdom paints
    // nothing: `bg-surface-cta` / `text-text-on-cta` is `AgentEndedPill`'s own recipe.
    const pill = await screen.findByText(ENDED_NOTE);
    expect(pill.className).toContain("bg-surface-cta");
    expect(pill.className).toContain("text-text-on-cta");
    // ⚠ EXACTLY ONE — the log row it replaced must not still be beside it. And the rest of the
    // log is untouched.
    expect(screen.getAllByText(ENDED_NOTE)).toHaveLength(1);
    expect(screen.getByText("all done")).toBeTruthy();
    // 🔒 ON THE THREAD LINE'S RIGHT, not a row of its own — the badge and the "in <thread>" text
    // share one parent (Samuel's second move).
    expect(pill.parentElement!.textContent).toContain("in UI-kit design");
  });

  /** ⚠ AN ENDED AGENT IS NEVER UNMARKED: no narration op, or a ring whose end predates the
   *  notice, still gets the bare "Ended" — `AgentEndedPill`'s default. */
  it("falls back to the bare word when main said nothing about the end", async () => {
    installBridge({ sessions: [summary({ state: "ended" })], entries: [] });
    await mount();
    const pill = await screen.findByText("Ended");
    expect(pill.className).toContain("bg-surface-cta");
    // ⚠ **AND `AgentLiveness` DOES NOT ALSO RENDER.** `agentLiveness` answers `Ended` for a dead
    // agent, so an unguarded slot would put a dot-and-word "Ended" beside the pill — the
    // "one fact, one element" rule `agent-bits.tsx` opens with, in the one place both are built.
    expect(screen.getAllByText("Ended")).toHaveLength(1);
  });

  /** ⚠ NOTHING IS LIFTED OUT OF A LIVE AGENT'S LOG — a retained ring can hold an end from a key
   *  that was reopened, and hiding that line with no badge to put it in is the one outcome this
   *  move must not produce. */
  it("leaves a LIVE agent's log alone and draws no pill", async () => {
    installBridge({ entries: [{ at: 1, kind: "status", text: ENDED_NOTE }] });
    await mount();
    const note = await screen.findByText(ENDED_NOTE);
    expect(note.className).not.toContain("bg-surface-cta");
  });
});
