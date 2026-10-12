// @vitest-environment jsdom
/**
 * **GRAMMAR B, WIRED INTO A REAL TRANSCRIPT** (Samuel's card #4401, 2026-10-12).
 *
 * ⚠ **THE SEAM IS THE SUBJECT, NOT THE LEAF.** Its sibling
 * `transcript-citation.test.tsx` exists because the pill once shipped "complete
 * and inert" — the leaf was right and no host passed the props, so every test was
 * green and every `#1759` in the app was plain text. This field can fail the same
 * way twice over: the DTO can decide the state correctly and the row drop it, or
 * the row carry it and the body renderer never be handed it. So every case here
 * goes in as a `ChannelMessage`, through `channelRows` and `Transcript`, and is
 * read off the rendered DOM.
 *
 * ⚠ **THE TWO HEADLINE CASES POINT OPPOSITE WAYS**, and between them they are the
 * ruling:
 *   • an UNSTAMPED row still pills `#1759` — the legacy face is untouched, which
 *     is what makes the DTO's "unknown mode falls back to legacy" a safe fallback
 *     rather than a blank;
 *   • a STAMPED row that cited nothing pills NOTHING, so a typed `#12` is text.
 *     That is the case the whole grammar was chosen for, and it is the common one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Transcript } from "./transcript";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { member, message, ME, PEER } from "./test-fixtures";
import type { ResolvedCite } from "../lib/cites";

afterEach(cleanup);

const INDEX = indexMembers(
  [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
  ],
  ME
);

/** A citation as the server resolves and stores it. */
function cite(over: Partial<ResolvedCite> = {}): ResolvedCite {
  return { messageId: "m-cited", seq: 1759, no: null, thread: null, ...over };
}

/**
 * One message, rendered in a transcript.
 *
 * ⚠ `cites` is passed as `undefined` to mean ABSENT — the legacy state — because
 * that is literally what an older server sends, and `?? null` in the view model
 * is the line that folds it onto the legacy arm.
 */
function renderBody(
  body: string,
  cites: ResolvedCite[] | null | undefined,
  over: { newestSeq?: number | null } = {}
) {
  const onJumpToSeq = vi.fn();
  render(
    <Transcript
      rows={channelRows(
        [message({ id: "m-row", seq: 3, body, authorUserId: PEER, cites })],
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

/**
 * The IN-BODY pills only.
 *
 * ⚠ **CHIPS ARE EXCLUDED BY ATTRIBUTE, NOT BY NAME.** `message-cite-chips.tsx`
 * renders the citations a body never mentioned, and it gives them the SAME
 * accessible name on purpose — both controls say "go to message" to a screen
 * reader. So they are indistinguishable by role and name, and a helper that
 * matched on name alone counted a chip as a pill: that is exactly what happened
 * when the chip row landed, and two correct refusals here went red.
 */
function pills(): HTMLElement[] {
  return screen
    .queryAllByRole("button", { name: /Go to message/ })
    .filter((el) => !el.hasAttribute("data-cite-chip"));
}

/** The rendered row's whole text — the body is split into leaves either way. */
function rowText(): string {
  return document.querySelector("article")?.textContent ?? "";
}

describe("an UNSTAMPED row keeps the legacy face", () => {
  it("🔒 pills a two-digit-or-more number as a global seq", () => {
    const { onJumpToSeq } = renderBody("re #1759 — fixed", undefined);
    expect(pills()).toHaveLength(1);
    fireEvent.click(pills()[0]);
    expect(onJumpToSeq).toHaveBeenCalledWith(1759);
  });

  it("🔒 and an explicit `null` is the same state", () => {
    // `null` is what the DTO answers for a row with no stamp, and what it answers
    // for a mode this build does not know. Both must render as they always have.
    expect(renderBody("re #1759 — fixed", null) && pills()).toHaveLength(1);
  });

  it("🔒 still refuses a single digit — the floor it always had", () => {
    renderBody("my #1 priority is this", undefined);
    expect(pills()).toHaveLength(0);
    expect(rowText()).toContain("#1 priority");
  });

  it("🔒 still refuses a seq above the pane's ceiling", () => {
    renderBody("re #1759 — fixed", undefined, { newestSeq: 100 });
    expect(pills()).toHaveLength(0);
  });
});

describe("a STAMPED row that cited NOTHING pills nothing", () => {
  it("🔒 a typed `#1759` is text, not a reference", () => {
    // ⚠ THE RULING ITSELF. Typing a number does not make a citation; citing a
    // message does. This is the common case — most messages cite nothing.
    renderBody("re #1759 — fixed", []);
    expect(pills()).toHaveLength(0);
    expect(rowText()).toContain("#1759");
  });

  it("🔒 `#1 priority` is prose, which is what the floor was approximating", () => {
    renderBody("my #1 priority is the #12 regression, see #4228", []);
    expect(pills()).toHaveLength(0);
    expect(rowText()).toContain("my #1 priority is the #12 regression, see #4228");
  });
});

describe("a STAMPED row pills exactly what it cited", () => {
  it("pills the cited number and jumps with the cited row's seq", () => {
    const { onJumpToSeq } = renderBody("re #1759 — fixed", [cite()]);
    expect(pills()).toHaveLength(1);
    fireEvent.click(pills()[0]);
    expect(onJumpToSeq).toHaveBeenCalledWith(1759);
  });

  it("🔒 leaves an UNCITED number in the same body as text", () => {
    renderBody("re #1759, not #4228", [cite({ seq: 1759 })]);
    expect(pills()).toHaveLength(1);
    expect(pills()[0].textContent).toBe("#1759");
    expect(rowText()).toContain("not #4228");
  });

  it("🔒 PILLS A SINGLE DIGIT when it was cited — the floor is gone here", () => {
    // What Samuel's pick bought: the floor was a guess standing in for "is this a
    // reference", and the allowlist answers that question exactly.
    const { onJumpToSeq } = renderBody("see #7 above", [cite({ seq: 7 })]);
    expect(pills()).toHaveLength(1);
    fireEvent.click(pills()[0]);
    expect(onJumpToSeq).toHaveBeenCalledWith(7);
  });

  it("🔒 matches the per-channel `no` and still jumps by `seq`", () => {
    // ⚠ THE TRANSITION CASE, and the reason the stored shape carries both
    // numbers. After the held migration an agent cites `no: 12` and writes `#12`;
    // the pill must be live, and the jump must use the seq, because that is what
    // the host's page-back hunt can look for.
    const { onJumpToSeq } = renderBody("see #12 in this room", [
      cite({ seq: 4228, no: 12 }),
    ]);
    expect(pills()).toHaveLength(1);
    expect(pills()[0].textContent).toBe("#12");
    fireEvent.click(pills()[0]);
    expect(onJumpToSeq).toHaveBeenCalledWith(4228);
  });

  it("🔒 ignores the pane's ceiling — the server already vouched", () => {
    // A pane with no page loaded knows no ceiling (`newestSeq === null`) and the
    // legacy arm correctly draws nothing. Here the write path resolved this entry
    // against this channel and refused the send otherwise, so withholding the
    // pill would hide a reference that is known to be good.
    renderBody("re #1759 — fixed", [cite()], { newestSeq: null });
    expect(pills()).toHaveLength(1);
  });

  it("pills every cited number in one body, in the author's order", () => {
    renderBody("both #1759 and #4228 matter", [
      cite({ seq: 1759 }),
      cite({ messageId: "m-2", seq: 4228 }),
    ]);
    expect(pills().map((p) => p.textContent)).toEqual(["#1759", "#4228"]);
  });

  it("takes the `seq 1759` spelling too", () => {
    const { onJumpToSeq } = renderBody("re seq 1759 — fixed", [cite()]);
    expect(pills()).toHaveLength(1);
    fireEvent.click(pills()[0]);
    expect(onJumpToSeq).toHaveBeenCalledWith(1759);
  });
});

describe("the pattern's other refusals are kept verbatim", () => {
  it("a BOLD citation still pills — only the floor changed", () => {
    renderBody("**#1759** please look", [cite()]);
    expect(pills()).toHaveLength(1);
  });

  it("🔒 a decimal tail is a version number, cited or not", () => {
    renderBody("upgraded to #17.59 today", [cite({ seq: 17 })]);
    expect(pills()).toHaveLength(0);
  });

  it("🔒 a hash inside a word is not a citation", () => {
    renderBody("the colour #fff and a#12 ref", [cite({ seq: 12 })]);
    expect(pills()).toHaveLength(0);
  });
});
