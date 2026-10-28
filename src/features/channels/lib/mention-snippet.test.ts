import { describe, expect, it } from "vitest";
import { MENTION_SNIPPET_LEAD_CHARS, mentionSnippetOf } from "./mention-snippet";

const ME = new Set(["samuel-wang", "samuel"]);
const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("mentionSnippetOf", () => {
  it("keeps a short body whole", () => {
    expect(mentionSnippetOf("hi @samuel-wang", ME, 240)).toBe("hi @samuel-wang");
  });

  it("keeps the leading clip when the tag is already near the front", () => {
    const body = `ok @samuel-wang ${filler(80)}`;
    const out = mentionSnippetOf(body, ME, 240);
    expect(out.startsWith("ok @samuel-wang")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("windows around a tag past the cut, with ellipses on both ends", () => {
    const body = `${filler(60)} please look @samuel-wang at this ${filler(60)}`;
    const out = mentionSnippetOf(body, ME, 240);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    const at = out.indexOf("@samuel-wang");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(MENTION_SNIPPET_LEAD_CHARS + 1);
    // never opens mid-word
    expect(out.slice(1).split(" ")[0]).toMatch(/^word\d+$/);
  });

  it("no trailing ellipsis when the window reaches the end", () => {
    const body = `${filler(60)} thanks @samuel`;
    const out = mentionSnippetOf(body, ME, 240);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("@samuel")).toBe(true);
  });

  it("ignores another member's tag and a tag inside code", () => {
    const body = `${filler(60)} \`@samuel-wang\` and @diana ${filler(60)}`;
    const out = mentionSnippetOf(body, ME, 240);
    expect(out.startsWith("word0")).toBe(true);
  });

  it("matches through trailing punctuation", () => {
    const body = `${filler(60)} ping @samuel-wang, thanks`;
    expect(mentionSnippetOf(body, ME, 240)).toContain("@samuel-wang, thanks");
    expect(mentionSnippetOf(body, ME, 240).startsWith("…")).toBe(true);
  });
});
