// The fact-line renderer: no value, however long or crafted, can run a line away or forge a field.
// The 300-char budget over what ops actually send is `tool-budget.test.ts`'s.

import { describe, it, expect } from "vitest";
import {
  FACT_VALUE_MAX,
  NOT_APPLICABLE,
  WRITE_RESULT_MAX_CHARS,
  factsLine,
  tagFact,
} from "./channel-facts";

describe("factsLine renders facts, not prose", () => {
  it("is a head verb followed by key=value pairs, in the order given", () => {
    // The identifier a follow-up call needs goes first.
    expect(factsLine("posted", { seq: 858, thread: undefined, addressed: false })).toBe(
      "posted seq=858 thread=- addressed=no",
    );
  });

  it("absent is a DASH, never a zero and never an omitted key", () => {
    // A missing key reads as "the server forgot to look", and `0` as a measurement nobody took.
    const line = factsLine("x", { a: null, b: undefined, c: "", d: 0 });
    expect(line).toBe(`x a=${NOT_APPLICABLE} b=${NOT_APPLICABLE} c=${NOT_APPLICABLE} d=0`);
  });

  it("booleans read as yes/no, because `addressed=false` reads as a field that failed to populate", () => {
    expect(factsLine("x", { addressed: true, idle: false })).toBe("x addressed=yes idle=no");
  });
});

describe("no input can push a line past the budget", () => {
  it("clips a single oversized value", () => {
    const line = factsLine("posted", { note: "z".repeat(500) });
    expect(line.length).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
    expect(line).toContain("…");
  });

  it("clips EVERY value, so the line's length depends on FIELD COUNT and nothing else", () => {
    // Values are clipped, so length depends only on field count; "always ≤ 300" is NOT a property of
    // the renderer (nine maximal fields exceed it), it is held over real fixtures by `tool-budget.test.ts`.
    const n = 9;
    const fields = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`k${i}`, "y".repeat(300)]),
    );
    const line = factsLine("posted", fields);
    const bound = "posted".length + n * ("k0".length + 1 + FACT_VALUE_MAX + 1);
    expect(line.length).toBeLessThanOrEqual(bound);
    expect(line.match(/…/g) ?? []).toHaveLength(n);
  });

  it("the field sets the ops ACTUALLY send fit the budget", () => {
    // `post` sends the most fields (9); a tenth field fails here first.
    const line = factsLine("posted", {
      seq: 858,
      msg: "44444444-4444-4444-4444-444444444444",
      thread: "33333333-3333-3333-3333-333333333333",
      landed: "thread",
      addressed: true,
      intent: "request",
      tags: "0/1",
      wake: "@agent-x2sz1ztt",
      hold: "since:858",
    });
    expect(line.length, line).toBeLessThanOrEqual(WRITE_RESULT_MAX_CHARS);
  });

  it("keeps a UUID and an agent handle WHOLE — the values a caller has to copy", () => {
    // Clipping the id a follow-up call needs would make the result unusable, not short.
    const uuid = "33333333-3333-3333-3333-333333333333";
    expect(uuid.length).toBeLessThanOrEqual(FACT_VALUE_MAX);
    const line = factsLine("opened", { thread: uuid, agent: "@agent-x2sz1ztt" });
    expect(line).toContain(`thread=${uuid}`);
    expect(line).toContain("agent=@agent-x2sz1ztt");
  });
});

describe("a value cannot forge the line's structure", () => {
  it("quotes a value containing whitespace, so the pairs stay parseable", () => {
    // Peer- and operator-authored values carry spaces; unquoted, nobody can see where one ends.
    expect(factsLine("launched", { identity: "Code Auditor" })).toBe(
      'launched identity="Code Auditor"',
    );
  });

  it("a crafted name cannot invent a field", () => {
    const line = factsLine("launched", { identity: "x addressed=yes" });
    expect(line).toBe('launched identity="x addressed=yes"');
    // The forged pair stays inside the quoted span, so the line still declares one field.
    expect(line.split(" ")[1].startsWith('identity="')).toBe(true);
  });

  it("markdown structure is blanked by the ONE neutralizer before it is quoted", () => {
    // `neutralizeInline` blanks markdown structure; the fact line must not re-introduce it (INVARIANTS §10).
    const line = factsLine("posted", { thread: "a`b|c[d]" });
    expect(line).not.toContain("`");
    expect(line).not.toContain("|");
  });

  it("a value that neutralizes to nothing is NOT REPORTED, never an empty span", () => {
    expect(factsLine("posted", { thread: "```" })).toBe(`posted thread=${NOT_APPLICABLE}`);
  });
});

describe("tagFact is a verdict, not a count", () => {
  it("is absent when the body carried no member handle at all", () => {
    // `0/0` would read as a failed tag on the majority of posts, which carry no `@`.
    expect(tagFact(0, 0)).toBeUndefined();
  });

  it("reports resolved over attempted, which is what catches a misspelled handle", () => {
    // The one signal that a tag reached nobody: an exact-match resolver posts a mistyped handle (INVARIANTS §10).
    expect(tagFact(0, 1)).toBe("0/1");
    expect(tagFact(1, 2)).toBe("1/2");
  });
});
