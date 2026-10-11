// @vitest-environment jsdom
/**
 * **THE TRANSCRIPT'S PREVIEW LANES — THE TWO THINGS THAT CHANGED UNDER THEM WHEN THE
 * INLINE MARKDOWN ARM LANDED** (release review, 2026-10-11).
 *
 * A thread card's opening line and a system row are PREVIEWS: a fragment of somebody
 * else's prose, drawn beside the bodies rather than as one. On 2026-10-10 both started
 * rendering through `message-markdown-inline.tsx` so their `**bold**` would read as bold,
 * and two properties nobody asked for came with it. Each fails silently, which is why
 * each is pinned here rather than noticed in a screenshot:
 *
 *  1. **AN AUTOLINK BECAME A LIVE EXTERNAL ANCHOR IN A LANE THAT WAS PLAIN TEXT.** The
 *     inline arm lexes with GFM ON, so a BARE `https://…` — and `a@b.com`, which lexes to
 *     a `mailto` link — is a `link` token with no markdown in the source at all. In a
 *     thread card that anchor sits among the card's two real buttons; in a system row it
 *     sits in a muted status line that has never been clickable. The orchestrator's
 *     ruling: **inside a preview, links render as TEXT**
 *     (`message-markdown.tsx › TextOnlyLinks`). The bodies keep theirs.
 *  2. **THE ROSTER WAS WALKED ONCE PER CARD, PER RENDER.** `bodyContextOf` builds a
 *     member × handles map plus an agent mention index, and the call sat UN-MEMOISED both
 *     in `transcript.tsx` (on every render, including a page with no system rows) and
 *     inside `ThreadCardMessage` — which renders inside the transcript's own `rows.map`.
 *     `mentions-list.tsx` holds one in a `useMemo` and documents exactly this rule; these
 *     two sites diverged from it. **Nothing fails when it regresses: the page just gets
 *     slower in proportion to the roster.**
 *
 * ⚠ A NEW FILE RATHER THAN A SECTION IN `transcript-body.test.tsx`, on this tree's own
 * §1 seam: that file is about how a BODY sits in its block (wrap, side, cap) and moves
 * when the row's geometry does. This one moves when the PREVIEW lanes' renderer does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * ⚠ **THE SPY DELEGATES, SO BEHAVIOUR IS UNCHANGED AND ONLY THE COUNT IS OBSERVED.**
 * `buildMentionIndex` is the expensive half of `bodyContextOf` and the one call that
 * proves whether a context was built per card or per page. Mocked at the MODULE so every
 * importer (the renderer, `lib/recipient-tags.ts`) shares the one spy — a partial mock
 * that replaced the function would change what the rows render and test the wrong thing.
 */
const { indexSpy } = vi.hoisted(() => ({ indexSpy: vi.fn() }));
vi.mock("../lib/mentions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mentions")>();
  return {
    ...actual,
    buildMentionIndex: (...args: Parameters<typeof actual.buildMentionIndex>) => {
      indexSpy();
      return actual.buildMentionIndex(...args);
    },
  };
});

import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import type { ThreadCardRow, TranscriptRow } from "./view-model-rows";
import { member, thread, ME, PEER } from "./test-fixtures";

afterEach(cleanup);
beforeEach(() => indexSpy.mockClear());

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

function cardRow(over: Partial<ThreadCardRow> = {}): ThreadCardRow {
  return {
    kind: "thread-card",
    id: "m-card",
    seq: 5,
    side: "peer",
    author: { userId: PEER, email: null, displayName: "Diana Taylor", avatarUrl: null },
    authorLabel: "Diana Taylor",
    time: "10:00",
    threads: [thread()],
    openThreadId: "t-1",
    preview: "take a look",
    ...over,
  };
}

function renderRows(rows: TranscriptRow[]) {
  return render(
    <Transcript rows={rows} index={INDEX} flashId={null} onOpenThread={vi.fn()} />
  );
}

// ── 1. THE LINK POLICY ───────────────────────────────────────────────────────────────

describe("a preview lane draws no anchors", () => {
  it("renders a BARE url in a thread card's preview as text", () => {
    // ⚠ NO MARKDOWN IN THE SOURCE — this is the autolink extension, which is why the
    // regression arrived with a change that was only ever about `**bold**`.
    const { container } = renderRows([
      cardRow({ preview: "repro at https://evil.example/x thanks" }),
    ]);
    expect(container.querySelector("a")).toBeNull();
    // ...and the destination still READS, which is more of what the author wrote, not less.
    expect(screen.getByText(/evil\.example/)).toBeTruthy();
  });

  it("renders an EMAIL in a thread card's preview as text — it lexes to a mailto link", () => {
    const { container } = renderRows([cardRow({ preview: "ping ops@evil.example" })]);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders an explicit markdown link in a preview as its own WORDS", () => {
    // The words survive and the destination does not — the same rendering an href that
    // fails `safeHref` has always produced, so there is one no-anchor shape, not two.
    const { container } = renderRows([
      cardRow({ preview: "see [the repro](https://evil.example/x)" }),
    ]);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/the repro/)).toBeTruthy();
  });

  it("renders a url in a SYSTEM row as text", () => {
    // A system row is a centred muted REPORT about the channel and has never been
    // clickable; an anchor in it is a destination the channel did not choose.
    const { container } = renderRows([
      { kind: "system", id: "m-sys", seq: 1, body: "joined from https://evil.example/x" },
    ]);
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByText(/evil\.example/)).toBeTruthy();
  });

  it("STILL renders the preview's emphasis — the arm is kept, only its links change", () => {
    // ⚠ THE NEGATIVE GUARD ON THE FIX: dropping back to plain text would also "pass" the
    // assertions above, and would undo #3128.
    const { container } = renderRows([cardRow({ preview: "shipped **today**" })]);
    expect(container.querySelector("strong")?.textContent).toBe("today");
    expect(container.textContent).not.toContain("**");
  });

  /**
   * 🔒 **AND A MESSAGE BODY IN THE SAME COLUMN KEEPS ITS ANCHOR.** The policy is a claim
   * about LANES, so the test that matters most is the one proving it did not leak: a
   * provider wrapped around a column instead of a preview would silently strip every link
   * in the transcript, which is a far worse defect than the one being fixed.
   */
  it("does NOT strip the anchor off a real message body beside it", () => {
    const { container } = renderRows([
      cardRow({ preview: "no link here" }),
      {
        kind: "message",
        id: "m-body",
        seq: 6,
        side: "peer",
        agent: false,
        author: { userId: PEER, email: null, displayName: "Diana Taylor", avatarUrl: null },
        authorLabel: "Diana Taylor",
        time: "10:01",
        body: "the docs are at https://example.com/d",
        continuation: false,
        mentionsMe: false,
      } as unknown as TranscriptRow,
    ]);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toContain("https://example.com/d");
  });
});

// ── 2. ONE ROSTER WALK PER PAGE ──────────────────────────────────────────────────────

describe("the preview context is built once for the page", () => {
  /** 20 cards, as a channel view holding a fan-out run really does. */
  const CARDS: TranscriptRow[] = Array.from({ length: 20 }, (_, i) =>
    cardRow({ id: `m-card-${i}`, seq: i + 1, preview: `card ${i}` })
  );

  it("walks the roster ONCE across a 20-card render, not once per card", () => {
    renderRows(CARDS);
    // 🔒 THE PROPERTY: the count does not scale with the rows. One is the page's own
    // context; `ThreadCardMessage` is handed it and builds none.
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });

  it("builds it once for BOTH lanes — system rows and cards share the page's context", () => {
    renderRows([
      { kind: "system", id: "m-sys", seq: 0, body: "Diana joined" },
      ...CARDS,
    ]);
    // Two un-memoised sites used to answer this with 21: one for the system lane and one
    // per card. The facts are identical (same roster, `mentionsMe: false`, no citation
    // ceiling), so there is one object.
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });

  it("does not rebuild it on a re-render that leaves the roster alone", () => {
    const { rerender } = renderRows(CARDS);
    indexSpy.mockClear();
    rerender(
      <Transcript rows={CARDS} index={INDEX} flashId="m-card-3" onOpenThread={vi.fn()} />
    );
    // The memo's dependency is the roster, and a flash id is not one. Un-memoised, this
    // walked it 21 more times for a tint.
    expect(indexSpy).toHaveBeenCalledTimes(0);
  });
});
