// @vitest-environment jsdom
/**
 * **THE CITATION PILL, WIRED INTO A REAL TRANSCRIPT** (2026-09-15).
 *
 * The parser is `lib/message-refs.test.ts`, the LEAF and its refusals are
 * `message-markdown-refs.test.tsx`. Both of those mount `MessageMarkdown`
 * directly and hand it the two props by hand — which is exactly what they should
 * do, and exactly why neither of them could catch the thing that was actually
 * broken: **a553a9ff shipped the pill complete and inert**, because no host
 * passed `newestSeq` or `onJumpToSeq` and both default to nothing. Every test was
 * green and every `#1759` in the app rendered as plain text.
 *
 * ⚠ **SO THE PROPERTY HERE IS THE SEAM, NOT THE PILL**: rows in, `Transcript`
 * renders, a citation in a real message body is pressable and hands its seq up.
 * A test that mounts the leaf cannot fail when the wiring is missing; this one
 * can, and it is the only file in the tree that can.
 *
 * ⚠ **ITS OWN FILE BECAUSE `transcript.test.tsx` SITS AT 499 LINES** against the
 * 500-line cap (INVARIANTS §1) — that file's own docblock already sends the pill
 * and the body wrap elsewhere for the same reason.
 *
 * ⚠ **THE HOST'S HALF IS NOT HERE.** Resolving a seq to a message id and moving
 * the scroller is `channel-surface.tsx › jumpToSeq`; what this pins is that the
 * seq arrives at all, and that both gates still refuse when a host withholds one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, ME, PEER } from "./test-fixtures";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

/**
 * A transcript holding ONE message whose body cites `#1759`.
 *
 * ⚠ The citing row's own seq is deliberately NOT 1759: a citation points at some
 * OTHER message, and a fixture where the two coincide would pass even if the code
 * were reading the wrong number off the row it is rendering.
 */
function renderCiting(
  over: { newestSeq?: number | null; onJump?: (seq: number) => void } = {}
) {
  const onJumpToSeq = over.onJump ?? vi.fn();
  render(
    <Transcript
      rows={channelRows(
        [message({ id: "m-cite", seq: 3, body: "re #1759 — fixed", authorUserId: PEER })],
        [],
        INDEX,
        formatChannelTimestamp
      )}
      index={INDEX}
      flashId={null}
      onOpenThread={vi.fn()}
      newestSeq={over.newestSeq === undefined ? 2000 : over.newestSeq}
      onJumpToSeq={onJumpToSeq}
    />
  );
  return { onJumpToSeq };
}

/** The rendered row's whole text. ⚠ The body is always split into leaves, so an
 *  assertion about a SENTENCE has to read the row rather than one node. */
function rowText(): string {
  return document.querySelector("article")?.textContent ?? "";
}

describe("a citation inside a rendered transcript", () => {
  it("is a pressable pill and hands its SEQ to the host", () => {
    // 🔒 THE REGRESSION THIS FILE EXISTS FOR. Drop either prop from
    // `transcript.tsx`'s `MessageMarkdown` call and this is the case that goes
    // red — the leaf's own suite stays green either way.
    const { onJumpToSeq } = renderCiting();

    const pill = screen.getByRole("button", { name: "Go to message 1759" });
    fireEvent.click(pill);

    // ⚠ THE SEQ, NOT A MESSAGE ID. The number is the pill's FACE and the id is the
    // address; resolution is the host's and must not migrate down here.
    expect(onJumpToSeq).toHaveBeenCalledWith(1759);
  });

  it("keeps the author's own text around it", () => {
    // The pill replaces the TOKEN, never the sentence.
    renderCiting();
    const row = screen.getByRole("button", { name: "Go to message 1759" }).closest("article");
    expect(row?.textContent).toContain("re");
    expect(row?.textContent).toContain("fixed");
    expect(row?.textContent).toContain("#1759");
  });

  /**
   * 🔒 **OUT-OF-WINDOW STILL JUMPS, AND THAT IS DELIBERATE.** `#12` is far below
   * the ceiling but is not one of the rows this pane loaded, so nothing on screen
   * matches it.
   *
   * ⚠ **THE PILL IS STILL DRAWN AND THE SEQ IS STILL HANDED UP**, because "is this
   * a message this channel could hold" and "is it currently on screen" are
   * different questions and only the first one is the pill's. The host resolves,
   * finds nothing in the loaded page, and the pane's existing
   * `SCROLL_TARGET_MISSING_NOTE` is what says so — one voice for one miss.
   * ⚠ Gating on "is it in `rows`" instead would make a citation flicker between
   * pill and plain text as older pages load, which is the transcript changing its
   * mind about what a message body says.
   */
  it("still hands up a seq the loaded page does not contain", () => {
    const { onJumpToSeq } = renderCiting();
    render(
      <Transcript
        rows={channelRows(
          [message({ id: "m-old", seq: 4, body: "see #12 for context", authorUserId: PEER })],
          [],
          INDEX,
          formatChannelTimestamp
        )}
        index={INDEX}
        flashId={null}
        onOpenThread={vi.fn()}
        newestSeq={2000}
        onJumpToSeq={onJumpToSeq}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Go to message 12" }));
    expect(onJumpToSeq).toHaveBeenCalledWith(12);
  });
});

describe("the two gates survive the wiring", () => {
  it("draws no pill when the host knows no ceiling", () => {
    // ⚠ `null` IS "CANNOT SAY" — an empty pane, or one whose page has not arrived.
    // A ceiling-less host must render the author's text, never a hopeful pill.
    renderCiting({ newestSeq: null });
    expect(screen.queryByRole("button", { name: /Go to message/ })).toBeNull();
    // ⚠ READ OFF THE ROW, NOT A SINGLE NODE: the parser splits a body into leaves
    // either way, so the token is its own element even when it renders as text.
    expect(rowText()).toContain("#1759");
  });

  it("draws no pill when the host cannot jump", () => {
    // 🔒 THE POP-OUT'S CASE (`thread-window.tsx` hands no `onJumpToSeq`):
    // absent-not-disabled, so the citation is plain text rather than a dead control.
    render(
      <Transcript
        rows={channelRows(
          [message({ id: "m-cite", seq: 3, body: "re #1759 — fixed", authorUserId: PEER })],
          [],
          INDEX,
          formatChannelTimestamp
        )}
        index={INDEX}
        flashId={null}
        onOpenThread={vi.fn()}
        newestSeq={2000}
      />
    );
    expect(screen.queryByRole("button", { name: /Go to message/ })).toBeNull();
    expect(rowText()).toContain("#1759");
  });

  it("refuses a seq above the ceiling", () => {
    // The pane holds nothing that new, so the number names no message.
    renderCiting({ newestSeq: 100 });
    expect(screen.queryByRole("button", { name: /Go to message/ })).toBeNull();
  });
});
