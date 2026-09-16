/**
 * THE MESSAGE-CITATION PATTERN (2026-09-15). ⚠ Almost every case here is a
 * NEGATIVE, and that is the shape of the feature: a pill that jumps nowhere
 * teaches a reader to distrust every pill, so the pattern has to decline more
 * than it accepts. Real bodies from this channel are the fixtures.
 */
import { describe, expect, it } from "vitest";
import {
  MESSAGE_REF_TOKEN_RE,
  isCitableSeq,
  messageRefSeq,
} from "./message-refs";

/** What a leaf sees: the tokens a split hands back, in order. */
const tokensOf = (text: string) =>
  text.split(MESSAGE_REF_TOKEN_RE).filter((p) => messageRefSeq(p ?? "") !== null);

describe("what counts as a citation", () => {
  it("reads the idioms agents actually type here", () => {
    expect(tokensOf("re #1759 — see my note")).toEqual(["#1759"]);
    expect(tokensOf("Found it. Seq #1718 is a task_progress marker")).toEqual(["#1718"]);
    expect(tokensOf("the rows (#1718, #1724, #1733)")).toEqual(["#1718", "#1724", "#1733"]);
    expect(tokensOf("seq 1759 reads back whole over MCP")).toEqual(["seq 1759"]);
    expect(tokensOf("SEQ 1800 is the one")).toEqual(["SEQ 1800"]);
    expect(messageRefSeq("#1759")).toBe(1759);
    expect(messageRefSeq("seq 1759")).toBe(1759);
  });

  it("declines the numbers that are NOT citations", () => {
    // Each of these appears in ordinary product prose, and each would have been a
    // dead pill.
    for (const prose of [
      "#1 on the list",            // a rank, not a seq
      "colour #fff on the pill",   // a hex triplet
      "a##2 double hash",          // not an opener
      "issue a#12 in the tracker", // a word character before the hash
      "#1759x is a build id",      // the run continues
      "version #17.59",            // ...as does this one
      "sequence 1759 of events",   // `seq` must be the whole word
      "3096/3096 tests",           // bare numbers are never citations
      "the 1759 build",
    ]) {
      expect(tokensOf(prose)).toEqual([]);
    }
  });

  it("is stateless across calls — the `g` flag cannot leak a lastIndex", () => {
    // The classic shared-regex bug: a `g` regex reused with `.test`/`.exec` carries
    // `lastIndex`. `split` does not, and this pins that nothing else starts to.
    expect(tokensOf("#1718")).toEqual(["#1718"]);
    expect(tokensOf("#1718")).toEqual(["#1718"]);
  });

  it("keeps the surrounding text intact, so a body is never rewritten", () => {
    // ⚠ The split must preserve every character: the leaf renders the parts back
    // out, and a dropped fragment would silently edit somebody's message.
    const body = "re #1759 and seq 1800, plus #1 which is not one";
    expect(body.split(MESSAGE_REF_TOKEN_RE).join("")).toBe(body);
  });
});

describe("the second gate: could this channel hold that seq", () => {
  it("accepts an OLD seq — the common case, and usually out of the window", () => {
    expect(isCitableSeq(12, 1900)).toBe(true);
    expect(isCitableSeq(1900, 1900)).toBe(true);
  });

  it("refuses a seq above the newest row — it names no message", () => {
    expect(isCitableSeq(9001, 1900)).toBe(false);
  });

  it("draws NOTHING when the newest seq is unknown", () => {
    // A pane that has not loaded a page knows no ceiling; guessing one would draw
    // pills it cannot stand behind (INVARIANTS §11 — unknown is not empty).
    expect(isCitableSeq(1759, null)).toBe(false);
  });
});
