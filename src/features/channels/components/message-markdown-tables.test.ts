import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { normalizePipeTables } from "./message-markdown-tables";

/**
 * The pipe-grid promotion, pinned from BOTH ends: what it rewrites, and — the half that
 * matters more — what it refuses. Every case is lexed with the renderer's own options, so
 * the assertion is "does this reach the table branch", not "does the string look right".
 */
const lex = (text: string) =>
  marked.lexer(normalizePipeTables(text), { gfm: true, breaks: false }).map((t) => t.type);

describe("normalizePipeTables", () => {
  it("promotes a delimiter-less pipe grid — the agent table that rendered as raw pipes", () => {
    expect(lex("| Fix | File |\n| highlight | authored-row.tsx |")).toContain("table");
  });

  it("leaves a real GFM table byte-identical", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(normalizePipeTables(table)).toBe(table);
    expect(lex(table)).toContain("table");
  });

  it("REFUSES the wire format — pipes as separators in prose", () => {
    const wire = "READER-MAIN→ORCH | EVIDENCE | three things from the main-process read";
    expect(normalizePipeTables(wire)).toBe(wire);
    expect(lex(wire)).toEqual(["paragraph"]);
  });

  it("refuses a lone pipe-fenced line — one row is a sentence, not a grid", () => {
    expect(lex("| just | one |")).toEqual(["paragraph"]);
  });

  it("refuses a ragged run rather than inventing or dropping a cell", () => {
    expect(lex("| a | b |\n| c | d | e |")).toEqual(["paragraph"]);
  });

  it("never rewrites inside a fence — a code sample is quoted text", () => {
    const fenced = "```\n| a | b |\n| c | d |\n```";
    expect(normalizePipeTables(fenced)).toBe(fenced);
    expect(lex(fenced)).toEqual(["code"]);
  });

  it("keeps an escaped pipe as content when counting cells", () => {
    // Three walls, so two cells on both lines — the escaped pipe is inside cell one.
    expect(lex("| a \\| b | c |\n| d | e |")).toContain("table");
  });

  it("is a no-op on a body with no pipe at all", () => {
    const plain = "**bold** and a list:\n- one\n- two";
    expect(normalizePipeTables(plain)).toBe(plain);
  });
});
