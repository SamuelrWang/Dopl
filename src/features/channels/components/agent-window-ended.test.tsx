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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen } from "@testing-library/react";
import { installBridge, mount, summary } from "./agent-window-harness";
import { splitEndNote } from "./agent-stream-lanes";
import type { AgentNarrationEntry } from "./use-agent-narration";

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
 * 🔒 **THE END IS ONE BLACK PILL, AND NOWHERE ELSE** (Samuel, 2026-09-15: *"I don't want the badges
 * to be there. … You see 'Ended by you.' Have 'Ended by you' be that black badge, right?"* — see
 * the file header for the second move, onto the thread line).
 *
 * 🔒 MUTATION-PROOF: draw the pill anywhere but the thread row and the first case fails; drop
 * `splitEndNote` and the sentence comes back as a log row beside the pill; drop the `ended` gate
 * and the third fails.
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

/**
 * 🔒 **THE CROSS-TREE PIN: EVERY SENTENCE MAIN CAN END WITH REACHES THE BADGE.**
 *
 * ⚠ **`splitEndNote` MATCHES MAIN'S TEXT, AND THE TWO TREES CANNOT IMPORT EACH OTHER** — so a
 * reword in `dopl-desktop-app/main/session-effects.js › endedStatusText` would silently stop the
 * lift and put the raw sentence back in the log with no badge and nothing red. The splitter fails
 * SAFE either way; what it cannot do is tell anyone it stopped working. This reads main's own
 * table and drives every sentence in it through the splitter, the same source-read seam
 * `agent-color-schema.test.ts` uses for the desktop's colour pattern.
 *
 * ⚠ **THE COUNT IS ASSERTED TOO** — a table this extraction cannot read (renamed function,
 * sentences moved to a constant) must fail here rather than pass over an empty list.
 *
 * 🔒 MUTATION-PROOF: reword any arm of `endedStatusText` away from "Ended…" and this fails while
 * every render case above keeps passing.
 */
describe("main's end sentences and the splitter agree", () => {
  /** The arms of `endedStatusText` — its quoted returns. The bare-`reason` fallback is not one and
   *  is not meant to be: an unlearned reason stays in the log as today's muted line. */
  const SENTENCES = (() => {
    const src = readFileSync(
      join(import.meta.dirname, "../../../../dopl-desktop-app/main/session-effects.js"),
      "utf8"
    );
    const from = src.indexOf("function endedStatusText");
    const body = src.slice(from, src.indexOf("\n}", from));
    return [...body.matchAll(/return '([^']+)'/g)].map((m) => m[1]!);
  })();

  it("lifts every one of main's four end sentences out of the log", () => {
    expect(SENTENCES, "main's end table moved or was renamed").toHaveLength(4);
    for (const text of SENTENCES) {
      const entries: AgentNarrationEntry[] = [
        { at: 1, kind: "assistant", text: "all done" },
        { at: 2, kind: "status", text },
      ];
      const split = splitEndNote(entries);
      expect(split.endNote, text).toBe(text);
      expect(split.entries, text).toHaveLength(1);
    }
  });
});
