/**
 * The scroll-back window's rules, with no React and no network.
 *
 * The one worth reading twice is the CONTIGUITY suite: it is the only thing
 * standing between a reader and a silent hole in their own history, and the
 * failing case (`seq` gaps are normal, the newest page outruns the boundary) is
 * not one anybody would guess from the shape of the data.
 */

import { describe, expect, it } from "vitest";
import type {
  ChannelFoldedArtifact,
  ChannelMessage,
  ChannelReadEntry,
} from "../types";
import {
  appendOlderPage,
  dropThreadFromWindow,
  EMPTY_MESSAGE_WINDOW,
  foldedArtifactsOf,
  isContiguous,
  mergeEntries,
  mergeWindow,
  oldestSeq,
  type MessageWindow,
} from "./message-window";

const CHANNEL = "chan-1";

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: "user-1",
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-31T00:00:00Z",
    authorName: null,
    authorAvatarUrl: null,
    ...over,
  };
}

function windowOf(
  older: ChannelMessage[],
  boundarySeq: number | null,
  exhausted = false,
  artifacts: ChannelFoldedArtifact[] = []
): MessageWindow {
  return { older, boundarySeq, exhausted, artifacts };
}

/**
 * ⚠ `count`, `firstSeq` and `lastSeq` are CHANNEL-WIDE by the type's contract —
 * "never over the page" — which is exactly why two pages' copies of one artifact
 * are interchangeable and the dedupe below is a de-duplication rather than a
 * reconciliation.
 */
function folded(id: string, count = 7, span: [number, number] = [900, 1200]) {
  return {
    artifact: {
      id,
      channelId: CHANNEL,
      workspaceId: "ws-1",
      name: `artifact ${id}`,
      summary: "a summary",
      createdBy: "user-1",
      createdByAgent: null,
      dissolvedAt: null,
      createdAt: "2026-08-31T00:00:00Z",
    },
    count,
    firstSeq: span[0],
    lastSeq: span[1],
  } satisfies ChannelFoldedArtifact;
}

/** A page's envelope, as the route sends it: the unfolded arms plus the cards. */
function envelope(
  unfolded: ChannelMessage[],
  cards: ChannelFoldedArtifact[]
): ChannelReadEntry[] {
  return [
    ...unfolded.map((message) => ({ type: "message", message }) as const),
    ...cards.map((card) => ({ type: "artifact", folded: card }) as const),
  ];
}

/** The message arms of a built envelope, by seq — what `unfoldedMessages` sees. */
function armSeqs(entries: ChannelReadEntry[] | null): number[] {
  return (entries ?? [])
    .filter((e) => e.type === "message")
    .map((e) => (e.type === "message" ? e.message.seq : -1));
}

/** The card ids of a built envelope. */
function cardIds(entries: ChannelReadEntry[] | null): string[] {
  return (entries ?? [])
    .filter((e) => e.type === "artifact")
    .map((e) => (e.type === "artifact" ? e.folded.artifact.id : ""));
}

describe("oldestSeq", () => {
  it("is null for an empty page and the minimum otherwise", () => {
    expect(oldestSeq([])).toBeNull();
    // ⚠ NOT `page[0].seq`. Ordering is the caller's business, and a cursor
    // derived from a positional assumption is wrong exactly once.
    expect(oldestSeq([msg(40), msg(12), msg(31)])).toBe(12);
  });
});

describe("isContiguous", () => {
  it("is trivially true before any history is loaded", () => {
    expect(isContiguous(EMPTY_MESSAGE_WINDOW, [msg(900)])).toBe(true);
  });

  it("holds while the newest page still reaches back to the boundary", () => {
    const win = windowOf([msg(10), msg(20)], 30);
    expect(isContiguous(win, [msg(30), msg(40)])).toBe(true);
    // Reaching FURTHER back than the boundary overlaps, which is fine —
    // `mergeWindow` deduplicates.
    expect(isContiguous(win, [msg(20), msg(30), msg(40)])).toBe(true);
  });

  it("BREAKS when the newest page has outrun the boundary", () => {
    // The live case: more than a page of messages landed while the reader sat in
    // history, so the newest page no longer touches where the buffer stopped.
    // Everything between 30 and 500 is held by neither half.
    const win = windowOf([msg(10), msg(20)], 30);
    expect(isContiguous(win, [msg(500), msg(510)])).toBe(false);
  });

  it("does not read a `seq` GAP as a missing row", () => {
    // ⚠ `seq` is a TABLE-wide identity, so two adjacent posts in one channel are
    // never adjacent numbers. A rule that inferred holes from arithmetic would
    // call this discontinuous and drop a perfectly good window.
    const win = windowOf([msg(4), msg(19)], 91);
    expect(isContiguous(win, [msg(91), msg(2400)])).toBe(true);
  });

  it("treats an EMPTY newest page as contiguous", () => {
    expect(isContiguous(windowOf([msg(1)], 5), [])).toBe(true);
  });
});

describe("mergeWindow", () => {
  it("returns the page untouched when no history is loaded", () => {
    const page = [msg(1), msg(2)];
    expect(mergeWindow(EMPTY_MESSAGE_WINDOW, page)).toEqual(page);
  });

  it("puts history in FRONT, ascending by seq", () => {
    const win = windowOf([msg(5), msg(6)], 7);
    expect(mergeWindow(win, [msg(7), msg(8)]).map((m) => m.seq)).toEqual([
      5, 6, 7, 8,
    ]);
  });

  it("deduplicates an overlap, and the PAGE's copy wins", () => {
    // The page is the entry the optimistic writes patch, so its row is fresher.
    const stale = msg(7, { body: "stale" });
    const fresh = msg(7, { body: "fresh" });
    const merged = mergeWindow(windowOf([msg(6), stale], 8), [fresh, msg(8)]);
    expect(merged.map((m) => m.seq)).toEqual([6, 7, 8]);
    expect(merged[1].body).toBe("fresh");
  });

  it("keeps a PENDING row last", () => {
    // `buildPendingMessage` stamps max(seq) + 1 over the whole cache entry, so a
    // not-yet-saved message sorts after every real one even with history loaded.
    const pending = msg(9, { id: "pending:abc", clientMsgId: "abc" });
    const merged = mergeWindow(windowOf([msg(1)], 4), [msg(4), pending]);
    expect(merged.map((m) => m.id)).toEqual(["m-1", "m-4", "pending:abc"]);
  });
});

describe("appendOlderPage", () => {
  it("prepends the page and records the boundary from the FIRST fetch only", () => {
    const first = appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(8), msg(9)], 10, 2);
    expect(first.older.map((m) => m.seq)).toEqual([8, 9]);
    expect(first.boundarySeq).toBe(10);

    const second = appendOlderPage(first, [msg(6), msg(7)], 8, 2);
    expect(second.older.map((m) => m.seq)).toEqual([6, 7, 8, 9]);
    // ⚠ STILL 10. The witness describes the window's TOP edge — where the newest
    // page stood when history began — and later pages extend the BOTTOM.
    expect(second.boundarySeq).toBe(10);
  });

  it("marks the window exhausted on a SHORT page, and the flag latches", () => {
    const short = appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(1)], 5, 50);
    expect(short.exhausted).toBe(true);
    expect(appendOlderPage(short, [], 1, 50).exhausted).toBe(true);
  });

  it("does NOT mark exhausted on a full page", () => {
    expect(
      appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(1), msg(2)], 5, 2).exhausted
    ).toBe(false);
  });

  it("still takes the boundary from an EMPTY first page", () => {
    // An empty page means the channel ended exactly at the cursor. The window
    // must still remember where it stopped or the next newest-page refetch has
    // no witness to check itself against.
    const win = appendOlderPage(EMPTY_MESSAGE_WINDOW, [], 12, 50);
    expect(win.boundarySeq).toBe(12);
    expect(win.exhausted).toBe(true);
  });
});

describe("dropThreadFromWindow", () => {
  it("drops history rows tagged for the deleted thread", () => {
    const win = windowOf(
      [msg(1), msg(2, { metadata: { taskId: "t-1" } }), msg(3)],
      4
    );
    expect(dropThreadFromWindow(win, "t-1").older.map((m) => m.seq)).toEqual([
      1, 3,
    ]);
  });

  it("returns the SAME window when nothing matched", () => {
    // Identity matters: the merge downstream is memoised on this array.
    const win = windowOf([msg(1)], 2);
    expect(dropThreadFromWindow(win, "t-other")).toBe(win);
  });

  it("leaves the boundary and the exhausted flag alone", () => {
    const win = windowOf([msg(1, { metadata: { taskId: "t-1" } })], 9, true);
    const after = dropThreadFromWindow(win, "t-1");
    expect(after.older).toEqual([]);
    // ⚠ Deleting a thread does not un-load history: the window still reaches
    // back to where it did, and it is still exhausted if it was.
    expect(after.boundarySeq).toBe(9);
    expect(after.exhausted).toBe(true);
  });
});

/**
 * THE ARTIFACT ENVELOPE OVER THE MERGED ARRAY — the ONE invariant this half of
 * the file exists for: **`entries` is TOTAL over the `messages` it sits beside.**
 * Every message is a `message` arm or a member of an `artifact` arm, never
 * neither, because `channels-v2/derivations.ts` builds its ordinary rows from the
 * arms ALONE and a message the envelope forgets is a row the reader never sees.
 *
 * ⚠ THE TWO HAZARDS ARE FIRST, and they are the reason the wire was stopped once
 * rather than shipped: forwarding the newest page's envelope beside the merged
 * array drops the reader's whole scroll-back history (A) and their own just-typed
 * message (B), silently, with a green build.
 */
describe("mergeEntries — hazard A, scroll-back history", () => {
  it("keeps EVERY history row when only the newest page folded", () => {
    // The failing shape, stated: the card is on the newest page, three pages of
    // history are loaded, and the page's own envelope describes none of them.
    const history = [msg(1), msg(2), msg(3)];
    const newest = [
      msg(10, { artifactId: "a-1" }),
      msg(11, { artifactId: "a-1" }),
      msg(12),
    ];
    const entries = mergeEntries(
      [...history, ...newest],
      [],
      foldedArtifactsOf(envelope([msg(12)], [folded("a-1")]))
    );

    // Not one history row is lost, and the folded pair is NOT drawn twice.
    expect(armSeqs(entries)).toEqual([1, 2, 3, 12]);
    expect(cardIds(entries)).toEqual(["a-1"]);
  });

  it("is TOTAL — every message is an arm or a member, never neither", () => {
    const messages = [msg(1), msg(10, { artifactId: "a-1" }), msg(11)];
    const entries = mergeEntries(messages, [], [folded("a-1")]);
    const accounted = new Set([
      ...armSeqs(entries),
      ...messages.filter((m) => m.artifactId === "a-1").map((m) => m.seq),
    ]);
    expect([...accounted].sort((a, b) => a - b)).toEqual([1, 10, 11]);
  });

  it("anchors the card at its LOWEST MEMBER on the merged array", () => {
    // ⚠ NOT `firstSeq` (900 here). A channel-wide first member parks the card at
    // the top of every back-page it is not actually on.
    const entries = mergeEntries(
      [msg(1), msg(20, { artifactId: "a-1" }), msg(30, { artifactId: "a-1" })],
      [],
      [folded("a-1")]
    );
    expect(entries?.map((e) => e.type)).toEqual(["message", "artifact"]);
  });
});

describe("mergeEntries — hazard B, the sender's own message", () => {
  it("renders a PENDING row while the envelope is non-null", () => {
    // `optimistic-cache.ts` patches `{ messages }` and knows no `entries` key.
    // Synthesizing the arms from `messages` is what makes that safe: the row the
    // operator just typed is an arm because it is IN the array, not because a
    // patch remembered to add one.
    const pending = msg(99, { id: "pending:abc", clientMsgId: "abc" });
    const entries = mergeEntries(
      [msg(10, { artifactId: "a-1" }), pending],
      [],
      [folded("a-1")]
    );
    expect(armSeqs(entries)).toEqual([99]);
    expect(cardIds(entries)).toEqual(["a-1"]);
  });

  it("follows a RECONCILE and a RETAG with no patch of its own", () => {
    // The saved row replaces its pending twin in place, and a retag rewrites the
    // metadata. Both are `messages`-only patches; both land here for free.
    const saved = msg(99, { id: "m-99", metadata: { taskId: "t-1" } });
    const entries = mergeEntries([saved], [], [folded("a-1")]);
    expect(entries).toBeNull(); // no member of a-1 present at all
    expect(
      armSeqs(mergeEntries([saved, msg(10, { artifactId: "a-1" })], [], [folded("a-1")]))
    ).toEqual([99]);
  });

  it("drops BOTH HALVES on a thread delete, with no second rule", () => {
    // Every member of the artifact was tagged for the deleted thread, so the
    // card has nothing left to stand for and stops being emitted. A ghost card
    // over deleted rows is the failure this replaces.
    const doomed = [
      msg(10, { artifactId: "a-1", metadata: { taskId: "t-1" } }),
      msg(11, { artifactId: "a-1", metadata: { taskId: "t-1" } }),
    ];
    const cards = [folded("a-1")];
    expect(cardIds(mergeEntries([msg(1), ...doomed], [], cards))).toEqual(["a-1"]);
    // …and after the patch family has filtered them out of `messages`:
    expect(mergeEntries([msg(1)], [], cards)).toBeNull();
  });
});

describe("mergeEntries — the rest of the rule", () => {
  it("is IDENTITY when no page ever folded", () => {
    // ⚠ The ordinary channel, and the whole additive contract: `null` out means
    // the consumer renders `messages` exactly as it did before artifacts existed.
    expect(mergeEntries([msg(1), msg(2)], [], [])).toBeNull();
    expect(mergeEntries([], [], [])).toBeNull();
  });

  it("SYNTHESIZES arms for a page that did not fold, beside one that did", () => {
    // A history page with `entries: null` contributes no cards; its rows still
    // have to arrive as ordinary messages or they vanish under the other page's
    // envelope.
    const unfoldedPage = [msg(1), msg(2)];
    const foldedPage = [msg(10, { artifactId: "a-1" }), msg(11)];
    const entries = mergeEntries(
      [...unfoldedPage, ...foldedPage],
      foldedArtifactsOf(null),
      [folded("a-1")]
    );
    expect(armSeqs(entries)).toEqual([1, 2, 11]);
  });

  it("DEDUPES one artifact across two pages, and the card survives once", () => {
    const history = [msg(1, { artifactId: "a-1" })];
    const newest = [msg(9, { artifactId: "a-1" }), msg(10)];
    const entries = mergeEntries(
      [...history, ...newest],
      [folded("a-1")], // the history page's copy
      [folded("a-1")] // the newest page's copy — identical by contract
    );
    expect(cardIds(entries)).toEqual(["a-1"]);
    expect(armSeqs(entries)).toEqual([10]);
  });

  it("DEGRADES a member whose card is missing to an ordinary message", () => {
    // ⚠ The server's own rule, restated: a span whose card row is absent becomes
    // a message, never a dropped row. Keying the fold on "is this id one we
    // HOLD" rather than on "is the field set" is what implements it.
    const entries = mergeEntries(
      [msg(1, { artifactId: "gone" }), msg(2, { artifactId: "a-1" })],
      [],
      [folded("a-1")]
    );
    expect(armSeqs(entries)).toEqual([1]);
    expect(cardIds(entries)).toEqual(["a-1"]);
  });

  it("orders the arms ASCENDING, cards included", () => {
    // `unfoldedMessages` hands the arms to `channelRows` in the order it finds
    // them, so the order is load-bearing for the messages half.
    const entries = mergeEntries(
      [msg(1), msg(5, { artifactId: "a-1" }), msg(9)],
      [],
      [folded("a-1")]
    );
    expect(entries?.map((e) => e.type)).toEqual([
      "message",
      "artifact",
      "message",
    ]);
  });
});

describe("foldedArtifactsOf", () => {
  it("takes the CARDS and nothing else", () => {
    const cards = foldedArtifactsOf(envelope([msg(1)], [folded("a-1")]));
    expect(cards.map((c) => c.artifact.id)).toEqual(["a-1"]);
  });

  it("hands back ONE shared empty for null and for an unfolded page", () => {
    // Identity, not just emptiness: the memo above this is keyed on it, and an
    // ordinary channel must never move it.
    expect(foldedArtifactsOf(null)).toBe(foldedArtifactsOf(envelope([msg(1)], [])));
  });
});

describe("appendOlderPage — the artifacts it carries", () => {
  it("keeps a history page's cards", () => {
    const win = appendOlderPage(
      EMPTY_MESSAGE_WINDOW,
      [msg(8, { artifactId: "a-1" })],
      10,
      2,
      envelope([], [folded("a-1")])
    );
    expect(win.artifacts.map((a) => a.artifact.id)).toEqual(["a-1"]);
  });

  it("does not collect the same artifact twice, and keeps the array's identity", () => {
    const first = appendOlderPage(
      EMPTY_MESSAGE_WINDOW,
      [msg(8, { artifactId: "a-1" })],
      10,
      2,
      envelope([], [folded("a-1")])
    );
    const second = appendOlderPage(
      first,
      [msg(6, { artifactId: "a-1" })],
      8,
      2,
      envelope([], [folded("a-1")])
    );
    expect(second.artifacts.map((a) => a.artifact.id)).toEqual(["a-1"]);
    // ⚠ SAME ARRAY. A new one per page would rebuild the whole transcript on
    // every scroll-up that folded nothing new.
    expect(second.artifacts).toBe(first.artifacts);
  });

  it("defaults to no envelope, so a caller that passes none is unchanged", () => {
    expect(
      appendOlderPage(EMPTY_MESSAGE_WINDOW, [msg(1)], 5, 50).artifacts
    ).toEqual([]);
  });
});
