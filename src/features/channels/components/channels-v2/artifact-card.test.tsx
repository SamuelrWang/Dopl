// @vitest-environment jsdom
/**
 * THE ARTIFACT CARD AND THE ROW IT DRAWS FROM — the fold, as a reader sees it
 * (artifacts #1220 §4, A4 closing slice 2026-09-06).
 *
 * ⚠ ONE FILE FOR BOTH HALVES, ON PURPOSE (INVARIANTS §1: one reason to change).
 * `view-model-artifacts.ts` decides WHERE a card sits and WHAT run it holds, and
 * `artifact-card.tsx` decides how much of that run is showing — two files, but
 * one product question, and a split here would let the position pins and the
 * bound pins drift apart while both claimed to describe the same card.
 *
 * ⚠ THE HEIGHTS ARE STUBBED, AND THAT IS WHAT MAKES THE BOUND TESTABLE AT ALL
 * (the pattern is `agent-stream-sent-box.test.tsx`'s, and the reasoning is
 * copied because the trap is identical). jsdom lays nothing out: every
 * `scrollHeight` and `clientHeight` is 0, so the component's measurement would
 * answer "nothing ever overflows" and every assertion here would pass for the
 * wrong reason. {@link COLLAPSED_PX} STANDS IN for the real `calc()` clamp,
 * which jsdom never resolves — it is not an assertion about the clamp itself.
 *
 * ⚠ THE PROPERTIES, and each is a way this could ship wrong:
 *   - a card drawn somewhere other than where its run was;
 *   - a folded message rendered TWICE, once in the card and once as itself;
 *   - a run silently losing rows (the count says 12, four are shown, nothing
 *     says so);
 *   - a control on a card with nothing behind it, or missing on the long card it
 *     exists for;
 *   - a card that vanishes because its bodies were not on the page.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ARTIFACT_COLLAPSE_LABEL,
  ARTIFACT_EXPAND_LABEL,
  ArtifactCard,
  artifactSpanLabel,
} from "./artifact-card";
import {
  artifactRowFor,
  unfoldedMessages,
  withArtifactCards,
  type ArtifactMember,
} from "./view-model-artifacts";
import { indexMembers } from "./view-model";
import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../../types";

/** What the collapsed run is worth in this environment — a stand-in for the
 *  real `calc()` clamp, which jsdom does not resolve. */
const COLLAPSED_PX = 122;

/** The run's natural height, as the current test wants layout to report it. */
let contentPx = 0;

/** ⚠ CAPTURED AT LOAD, BEFORE ANYTHING IS STUBBED. In jsdom these live on
 *  `Element.prototype`, so there is usually nothing OWN to restore and the own
 *  property is deleted instead — both paths handled rather than assumed. */
const REAL = {
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
} as const;

function layoutIs(naturalPx: number) {
  contentPx = naturalPx;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return contentPx;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      // ⚠ THE CAP IS THE COMPONENT'S OWN INLINE STYLE — set while collapsed,
      // dropped when open — so the stub follows the state under test.
      return this.style.maxHeight ? COLLAPSED_PX : contentPx;
    },
  });
}

afterEach(() => {
  cleanup();
  for (const key of ["scrollHeight", "clientHeight"] as const) {
    const real = REAL[key];
    if (real) Object.defineProperty(HTMLElement.prototype, key, real);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
  contentPx = 0;
});

const MEMBERS: ArtifactMember[] = [
  { id: "m-2", seq: 2, authorLabel: "Dana", time: "09:01", body: "First." },
  { id: "m-3", seq: 3, authorLabel: "Dana", time: "09:02", body: "Second." },
];

function card(props: Partial<Parameters<typeof ArtifactCard>[0]> = {}) {
  return render(
    <ArtifactCard
      id="a-1"
      name="Rollout plan"
      summary=""
      count={2}
      firstSeq={2}
      lastSeq={3}
      members={MEMBERS}
      {...props}
    />
  );
}

describe("the card's face", () => {
  it("names the artifact and prints count and span over the WHOLE artifact", () => {
    layoutIs(40);
    card({ count: 12, firstSeq: 2, lastSeq: 99 });
    expect(screen.getByText("Rollout plan")).toBeTruthy();
    // ⚠ 12 and #2–#99, NOT the two members on this page: a count that meant
    // "of the ones you can see" answers a different question every page.
    expect(screen.getByText("12 messages · #2–#99")).toBeTruthy();
  });

  it("says so when the page holds fewer members than the artifact has", () => {
    layoutIs(40);
    card({ count: 12, firstSeq: 2, lastSeq: 99 });
    expect(screen.getByText(/Showing 2 of 12 here/)).toBeTruthy();
  });

  it("says nothing about partiality when the whole artifact is here", () => {
    layoutIs(40);
    card();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it("renders header-only rather than vanishing when no member is on the page", () => {
    layoutIs(40);
    card({ members: [] });
    expect(screen.getByText("Rollout plan")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads a one-member artifact in the singular, with one seq", () => {
    expect(artifactSpanLabel(1, 7, 7)).toBe("1 message · #7");
  });
});

describe("the bound on the folded run", () => {
  it("offers the control only when the run is taller than the clamp", () => {
    layoutIs(COLLAPSED_PX + 60);
    card();
    expect(screen.getByRole("button", { name: ARTIFACT_EXPAND_LABEL })).toBeTruthy();
  });

  it("offers NO control on a run that fits — no promise of more", () => {
    layoutIs(COLLAPSED_PX - 40);
    card();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("clamps a height and never slices the string — every body is in the DOM", () => {
    layoutIs(COLLAPSED_PX + 60);
    card();
    // ⚠ Collapsed, and BOTH bodies are present: the clip box is bounded, the
    // content is not cut (`agent-stream-prose.tsx` rule 4).
    expect(screen.getByText("First.")).toBeTruthy();
    expect(screen.getByText("Second.")).toBeTruthy();
  });

  it("keeps 'Show less' once open — the measurement does not re-run there", () => {
    layoutIs(COLLAPSED_PX + 60);
    card();
    fireEvent.click(screen.getByRole("button", { name: ARTIFACT_EXPAND_LABEL }));
    // ⚠ Open, the box has no cap and everything "fits" — re-measuring would pull
    // the control out from under the reader's cursor.
    expect(screen.getByRole("button", { name: ARTIFACT_COLLAPSE_LABEL })).toBeTruthy();
  });
});

/** A page message. ⚠ CAST, and deliberately: this suite is about the fold's
 *  POSITION, and spelling every field of a wire type here would pin the DTO in a
 *  file that has no opinion about it. */
function message(seq: number, artifactId: string | null = null): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    body: `body ${seq}`,
    createdAt: "2026-09-06T09:00:00.000Z",
    authorUserId: "u-2",
    authorKind: "user",
    kind: "message",
    metadata: {},
    artifactId,
  } as unknown as ChannelMessage;
}

/**
 * THE PEOPLE-LOOKUP THE ROWS ARE BUILT AGAINST — **built by the real
 * `indexMembers`, never hand-shaped**, and that is the fix for the six red
 * cases of 2026-09-06 rather than a tidy-up.
 *
 * ⚠ **THE HAND-SHAPED LITERAL NAMED A FIELD `AuthorIndex` DOES NOT HAVE.** It
 * was `{ currentUserId, members, agents } as unknown as AuthorIndex`; the index
 * is keyed `byId` (`view-model.ts › AuthorIndex`), so `labelFor`'s
 * `index.byId.get(...)` threw `TypeError: undefined is not an object` inside
 * `membersOf` — and every case that builds a MEMBER died there. That is exactly
 * the six that were red and neither of the two that were green: the two survivors
 * are the ones that never reach a member (`unfoldedMessages`, and the early
 * return on a page with no card). Nothing was wrong with the position rules.
 *
 * ⚠ **THE `as unknown as` CAST WAS THE DEFECT, NOT THE FIELD NAME** — it is what
 * let a wrong shape past `tsc` into a suite that then blamed the derivation. The
 * builder takes its place so the compiler owns this fixture: a future field on
 * `AuthorIndex` is a type error here, not six mystery reds (§14 — drive the real
 * function; a hand-retyped shape makes the proof vacuous).
 *
 * ⚠ EMPTY ROSTER, ON PURPOSE. These cases pin POSITION and CONSERVATION, and no
 * assertion in this file reads an author label — every member resolves through
 * `labelFor`'s honest last fallback.
 */
const INDEX = indexMembers([], "u-1");

const fmt = (iso: string) => iso.slice(11, 16);

function folded(id: string, count: number, first: number, last: number) {
  return {
    artifact: {
      id,
      name: `Artifact ${id}`,
      summary: "",
      dissolvedAt: null,
    },
    count,
    firstSeq: first,
    lastSeq: last,
  } as unknown as ChannelFoldedArtifact;
}

describe("entries → rows", () => {
  const page = [message(1), message(2, "a-1"), message(3, "a-1"), message(4)];
  const entries: ChannelReadEntry[] = [
    { type: "message", message: page[0] },
    { type: "artifact", folded: folded("a-1", 2, 2, 3) },
    { type: "message", message: page[3] },
  ];

  it("hands the caller ONLY the unfolded arms to build ordinary rows from", () => {
    // ⚠ The folded pair must not reach `channelRows`, or each would be drawn a
    // second time underneath the card that folded it.
    expect(unfoldedMessages(entries).map((m) => m.seq)).toEqual([1, 4]);
  });

  it("anchors the card at its lowest member seq ON THIS PAGE", () => {
    const row = artifactRowFor(folded("a-1", 9, 1, 40), page, INDEX, fmt);
    // ⚠ 2, not `firstSeq` 1: the artifact starts above this page, and anchoring
    // on the channel-wide first member would park the card at the top.
    expect(row.seq).toBe(2);
    expect(row.count).toBe(9);
    expect(row.members.map((m) => m.seq)).toEqual([2, 3]);
  });

  it("carries the folded bodies off the full page, which the envelope still has", () => {
    const row = artifactRowFor(folded("a-1", 2, 2, 3), page, INDEX, fmt);
    expect(row.members.map((m) => m.body)).toEqual(["body 2", "body 3"]);
  });

  it("splices the card between the rows it sat between", () => {
    const rows = [
      { kind: "message", seq: 1, continuation: false },
      { kind: "message", seq: 4, continuation: true },
    ];
    const out = withArtifactCards(rows, entries, page, INDEX, fmt);
    expect(out.map((r) => [r.kind, r.seq])).toEqual([
      ["message", 1],
      ["artifact", 2],
      ["message", 4],
    ]);
  });

  it("breaks the run: the row after a card is never a continuation", () => {
    const rows = [
      { kind: "message", seq: 1, continuation: false },
      { kind: "message", seq: 4, continuation: true },
    ];
    const out = withArtifactCards(rows, entries, page, INDEX, fmt);
    // ⚠ F-251's rule: a card has no attribution pill, so the row below it has
    // nothing to continue FROM.
    expect((out[2] as { continuation: boolean }).continuation).toBe(false);
    // ⚠ And the caller's own array is untouched — these rows come from a memo.
    expect(rows[1].continuation).toBe(true);
  });

  it("appends a card whose members are all newer than every remaining row", () => {
    const rows = [{ kind: "message", seq: 1, continuation: false }];
    const out = withArtifactCards(rows, entries, page, INDEX, fmt);
    expect(out.map((r) => r.kind)).toEqual(["message", "artifact"]);
  });

  it("conserves rows: nothing is dropped, one card per artifact", () => {
    const twice: ChannelReadEntry[] = [
      { type: "message", message: page[0] },
      { type: "artifact", folded: folded("a-1", 2, 2, 3) },
      { type: "artifact", folded: folded("a-2", 1, 5, 5) },
    ];
    const rows = [{ kind: "message", seq: 1, continuation: false }];
    const out = withArtifactCards(rows, twice, [...page, message(5, "a-2")], INDEX, fmt);
    expect(out).toHaveLength(3);
    expect(out.filter((r) => r.kind === "artifact")).toHaveLength(2);
  });

  it("returns the rows untouched when nothing on the page folded", () => {
    const rows = [{ kind: "message", seq: 1, continuation: true }];
    const out = withArtifactCards(rows, [{ type: "message", message: page[0] }], page, INDEX, fmt);
    expect(out).toEqual(rows);
  });
});
