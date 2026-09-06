/**
 * 🔒 **THE TWO PURE ARTIFACT RULES, PINNED WITHOUT A DATABASE** — the addressing
 * PIN (design §3) and the fold rule (design §4), from design #1220, accepted
 * wholesale at #1222.
 *
 * ⚠ **NO `vi.mock` BLOCK, AND THAT IS THE POINT.** `readNamesMessages` and
 * `foldEntries` were built pure precisely so these two rules could be pinned by
 * arithmetic rather than by a fixture room — they take the page and the
 * artifact facts as ARGUMENTS and touch no database. Importing the service does
 * still load the repository module, which is inert at import time (its Supabase
 * client is lazy and `vitest.setup.ts` sets the env its module-load guard
 * reads), so nothing here needs a double. If a later edit gives either function
 * a read of its own, these cases fail against a real client instead of passing
 * quietly against a mock: the impurity gets caught HERE.
 *
 * ⚠ **SPLIT OUT OF `service-artifacts.test.ts` ON 2026-09-06** (review pass 2)
 * along that file's own stated seam, which is what the two functions' own
 * docblock already claimed: it stood at 614 lines against the §1 cap of 500,
 * and it is the four WRITE actions that need doubles. The authority,
 * idempotency and un-box pins stay in the sibling; every assertion moved here
 * unchanged.
 */

import { describe, it, expect } from "vitest";
import type { ArtifactSpan } from "./repository-artifacts";
import type { ChannelArtifact, ChannelMessage } from "../types";
import { foldEntries, readNamesMessages } from "./service-artifacts";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ART_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function artifact(over: Partial<ChannelArtifact> = {}): ChannelArtifact {
  return {
    id: ART,
    channelId: CHANNEL,
    workspaceId: WORKSPACE,
    name: "Wrap-up",
    summary: "",
    createdBy: ME,
    createdByAgent: null,
    dissolvedAt: null,
    createdAt: "2026-09-06T00:00:00Z",
    ...over,
  };
}

function msg(seq: number, over: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id: `m-${seq}`,
    seq,
    channelId: CHANNEL,
    authorUserId: ME,
    authorKind: "user",
    kind: "message",
    body: `body ${seq}`,
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-09-06T00:00:00Z",
    authorName: null,
    authorAvatarUrl: null,
    artifactId: null,
    ...over,
  } as ChannelMessage;
}

function span(count: number, firstSeq: number, lastSeq: number): ArtifactSpan {
  return { count, firstSeq, lastSeq };
}

/* ─────────────────────────── THE ADDRESSING PIN ─────────────────────────── */

/**
 * 🔒 Design §3: "an explicit seq, or a range containing it, ALWAYS returns the
 * message, never the card. Folding affects the DEFAULT page only."
 *
 * ⚠ **THE LONE-`since` CASE IS THE ONE THAT MATTERS AND IT IS RATIFIED.** A
 * cursor names where to START, not what to return. Reading it as "a range
 * naming a message" would mean nothing ever folds, because the incremental read
 * IS the default read for every agent on the wire — the feature would ship dead
 * and nobody would see a failing test.
 */
describe("readNamesMessages — the addressing pin", () => {
  it("never folds a thread-scoped read: a thread is already a named subset", () => {
    expect(readNamesMessages({ thread: "task-1" })).toBe(true);
    expect(readNamesMessages({ thread: "task-1", since: 10 })).toBe(true);
    expect(readNamesMessages({ thread: "task-1", since: 10, before: 20 })).toBe(true);
  });

  it("never folds a BOUNDED WINDOW — since AND before is the range naming a message", () => {
    expect(readNamesMessages({ since: 1100, before: 1130 })).toBe(true);
  });

  it("FOLDS a lone since — a cursor is not a range naming a message", () => {
    expect(readNamesMessages({ since: 1100 })).toBe(false);
  });

  it("folds a lone before, and folds the newest page", () => {
    expect(readNamesMessages({ before: 1130 })).toBe(false);
    expect(readNamesMessages({})).toBe(false);
  });

  it("reads `undefined` as absent rather than as a bound", () => {
    // ⚠ The wire hands optional numbers through as `undefined`, so an explicit
    // undefined must behave exactly like an omitted key. A truthiness test would
    // also make `since: 0` absent, which is a real cursor.
    expect(readNamesMessages({ since: undefined, before: undefined })).toBe(false);
    expect(readNamesMessages({ since: 0, before: 0 })).toBe(true);
  });
});

/* ───────────────────────────────── THE FOLD ─────────────────────────────── */

describe("foldEntries — one card per artifact per page", () => {
  it("renders ONE card at the artifact's LOWEST member seq on the page", () => {
    const page = [
      msg(10),
      msg(11, { artifactId: ART }),
      msg(12, { artifactId: ART }),
      msg(13, { artifactId: ART }),
      msg(14),
    ];
    const entries = foldEntries(
      page,
      new Map([[ART, artifact()]]),
      new Map([[ART, span(3, 11, 13)]])
    );
    expect(entries.map((e) => e.type)).toEqual(["message", "artifact", "message"]);
    expect(entries[0]).toMatchObject({ message: { seq: 10 } });
    // ⚠ POSITION, not just presence: the card sits where seq 11 was, so a
    // reader scrolling past finds it where the run began.
    expect(entries[1]).toMatchObject({ folded: { artifact: { id: ART } } });
    expect(entries[2]).toMatchObject({ message: { seq: 14 } });
  });

  it("aggregates count and span over the WHOLE artifact, never over the page", () => {
    // Two members visible here; the artifact holds seven, spanning 900..1200.
    const page = [msg(1000, { artifactId: ART }), msg(1001, { artifactId: ART })];
    const entries = foldEntries(
      page,
      new Map([[ART, artifact()]]),
      new Map([[ART, span(7, 900, 1200)]])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "artifact",
      folded: { count: 7, firstSeq: 900, lastSeq: 1200 },
    });
    // ⚠ THE WHOLE POINT: a reader holding citation #1119 can tell it lives in
    // this box. Counting the page would answer 2 and span 1000..1001, which is
    // a different question every time the page moves.
  });

  it("renders a NON-MEMBER inside the span normally — never boxes a bystander", () => {
    const page = [
      msg(20, { artifactId: ART }),
      msg(21, { authorUserId: OTHER }), // inside the span, not a member
      msg(22, { artifactId: ART }),
    ];
    const entries = foldEntries(
      page,
      new Map([[ART, artifact()]]),
      new Map([[ART, span(2, 20, 22)]])
    );
    expect(entries.map((e) => e.type)).toEqual(["artifact", "message"]);
    expect(entries[1]).toMatchObject({ message: { seq: 21, authorUserId: OTHER } });
  });

  it("gives two interleaved artifacts one card each, in first-appearance order", () => {
    const page = [
      msg(30, { artifactId: ART_B }),
      msg(31, { artifactId: ART }),
      msg(32, { artifactId: ART_B }),
      msg(33, { artifactId: ART }),
    ];
    const entries = foldEntries(
      page,
      new Map([
        [ART, artifact()],
        [ART_B, artifact({ id: ART_B, name: "Other" })],
      ]),
      new Map([
        [ART, span(2, 31, 33)],
        [ART_B, span(2, 30, 32)],
      ])
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ folded: { artifact: { id: ART_B } } });
    expect(entries[1]).toMatchObject({ folded: { artifact: { id: ART } } });
  });

  it("degrades a member with MISSING FACTS to a message — never drops the row", () => {
    // ⚠ DATA LOSS ON A READ PATH is the failure being pinned here. A card
    // lookup that came back short must leave the transcript complete.
    const page = [msg(40, { artifactId: ART }), msg(41, { artifactId: ART_B })];
    const noArtifact = foldEntries(page, new Map(), new Map([[ART, span(1, 40, 40)]]));
    expect(noArtifact.map((e) => e.type)).toEqual(["message", "message"]);

    const noSpan = foldEntries(page, new Map([[ART, artifact()]]), new Map());
    expect(noSpan.map((e) => e.type)).toEqual(["message", "message"]);
    expect(noSpan.map((e) => (e.type === "message" ? e.message.seq : null))).toEqual([
      40, 41,
    ]);
  });

  it("conserves rows: every unfolded message on the page survives the fold", () => {
    const page = [msg(50), msg(51, { artifactId: ART }), msg(52), msg(53)];
    const entries = foldEntries(
      page,
      new Map([[ART, artifact()]]),
      new Map([[ART, span(1, 51, 51)]])
    );
    const seqs = entries.flatMap((e) => (e.type === "message" ? [e.message.seq] : []));
    expect(seqs).toEqual([50, 52, 53]);
  });

  it("answers an empty page with no entries and no invented card", () => {
    expect(foldEntries([], new Map(), new Map())).toEqual([]);
  });
});
