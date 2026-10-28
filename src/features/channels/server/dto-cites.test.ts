/**
 * **THE THREE STATES, AND THE KEY THEY ARE READ FROM** (grammar B, 2026-10-12).
 *
 * ⚠ **THE HEADLINE CASE IS `stamped + cited nothing` → `[]`, NOT `null`.** It is
 * the only assertion here that distinguishes reading the STAMP from reading the
 * LIST, and reading the list is the whole defect Samuel's ruling is against: an
 * uncited message is the overwhelming majority of messages, so a mapper that
 * answered `null` for "no cites" would linkify the typed `#12` in nearly every
 * new post — exactly the behaviour grammar B exists to delete.
 *
 * ⚠ **AND THE OTHER DIRECTION IS PINNED TOO**: an UNSTAMPED row must stay `null`
 * so it keeps the legacy `#NNNN` face it has always had. Those two cases bound
 * the field from both sides; everything else here is narrowing.
 */

import { describe, it, expect } from "vitest";

import { messageCitesOf } from "./dto-cites";
import { CITE_MODE_CURRENT } from "../lib/cites";

/** Metadata for a row written under the current grammar. */
function stamped(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { citeMode: CITE_MODE_CURRENT, ...extra };
}

const CITE = { messageId: "m-12", seq: 12, no: null, thread: null };

describe("the state is read from the stamp", () => {
  it("🔒 UNSTAMPED is `null` — the legacy face, unchanged", () => {
    expect(messageCitesOf({})).toBeNull();
    expect(messageCitesOf({ threadId: "t-1" })).toBeNull();
  });

  it("🔒 STAMPED but citing nothing is `[]` — written under the rule", () => {
    expect(
      messageCitesOf(stamped()),
      `\`[]\` is how a renderer knows this row's typed numbers are inert. Answering ` +
        `\`null\` here puts a pill back on every "#1 priority" in the product.`
    ).toEqual([]);
  });

  it("STAMPED with citations returns them", () => {
    expect(messageCitesOf(stamped({ cites: [CITE] }))).toEqual([CITE]);
  });

  it("🔒 a LEGACY mode value is not the current one", () => {
    expect(messageCitesOf({ citeMode: 1, cites: [CITE] })).toBeNull();
  });

  it("🔒 an UNKNOWN FUTURE mode falls back to legacy, never forward", () => {
    // A newer server writing mode 3 read by this build: the only grammar this
    // build can honour is the one it knows, and claiming the row would apply
    // mode 2's allowlist to rules it has never seen.
    expect(messageCitesOf({ citeMode: 3, cites: [CITE] })).toBeNull();
  });

  it("🔒 a FORGED-LOOKING stamp of the right value is still just the value", () => {
    // Nothing here authenticates the stamp — `insertMessage` does, by writing it
    // last on every row (`repository-messages-cite-stamp.test.ts`). This mapper's
    // job is only to read it, and the test says so rather than implying a check
    // that does not live here.
    expect(messageCitesOf({ citeMode: "2", cites: [CITE] })).toBeNull();
  });

  it("metadata that is not a record at all is legacy", () => {
    for (const junk of [null, undefined, "x", 3, [], true]) {
      expect(messageCitesOf(junk)).toBeNull();
    }
  });
});

describe("narrowing — a read degrades, it never throws", () => {
  it("a `cites` value that is not an array reads as cited-nothing", () => {
    // Still stamped, so the row IS grammar B; the list is simply unusable.
    for (const junk of ["x", 3, true, {}, null]) {
      expect(messageCitesOf(stamped({ cites: junk }))).toEqual([]);
    }
  });

  it("🔒 drops an entry with no usable id", () => {
    expect(
      messageCitesOf(
        stamped({ cites: [{ seq: 12 }, { messageId: "", seq: 12 }, { messageId: 7, seq: 12 }] })
      )
    ).toEqual([]);
  });

  it("🔒 drops an entry whose seq is not a positive integer", () => {
    const bad = [
      { messageId: "m", seq: 0 },
      { messageId: "m", seq: -1 },
      { messageId: "m", seq: 1.5 },
      { messageId: "m", seq: "12" },
      { messageId: "m", seq: true },
      { messageId: "m" },
    ];
    expect(messageCitesOf(stamped({ cites: bad }))).toEqual([]);
  });

  it("drops non-records and keeps the good entries around them", () => {
    const mixed = [null, CITE, "nope", { messageId: "m-20", seq: 20 }, 7];
    expect(messageCitesOf(stamped({ cites: mixed }))).toEqual([
      CITE,
      { messageId: "m-20", seq: 20, no: null, thread: null },
    ]);
  });

  it("keeps a valid `no` and nulls an unusable one", () => {
    expect(messageCitesOf(stamped({ cites: [{ messageId: "m", seq: 12, no: 3 }] }))).toEqual([
      { messageId: "m", seq: 12, no: 3, thread: null },
    ]);
    for (const junk of ["3", 0, -1, true, {}]) {
      expect(
        messageCitesOf(stamped({ cites: [{ messageId: "m", seq: 12, no: junk }] }))
      ).toEqual([{ messageId: "m", seq: 12, no: null, thread: null }]);
    }
  });

  it("nulls a thread that is not a string", () => {
    expect(
      messageCitesOf(stamped({ cites: [{ messageId: "m", seq: 12, thread: 7 }] }))
    ).toEqual([{ messageId: "m", seq: 12, no: null, thread: null }]);
  });

  it("🔒 nothing in here throws, whatever the row holds", () => {
    // A page read renders a transcript; one malformed row must not 500 it.
    const nasty = stamped({
      cites: [
        Object.create(null),
        { messageId: { toString: () => "m" }, seq: 12 },
        [],
        () => null,
      ],
    });
    expect(() => messageCitesOf(nasty)).not.toThrow();
  });
});
