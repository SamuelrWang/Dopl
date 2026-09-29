import { describe, expect, it } from "vitest";
import type { DisplayBlock, Positioned } from "@/features/display/core/types";
import { compileChatDisplay } from "./chat-display";
import { CHAT_AREA, CHAT_MAX_CONTAINERS, CHAT_MAX_PAGES } from "./display";

const TOP = CHAT_AREA.y;
const BOTTOM = CHAT_AREA.y + CHAT_AREA.h;

const compile = (blocks: unknown[]) => compileChatDisplay(blocks as Positioned<DisplayBlock>[]);

function expectFits(d: ReturnType<typeof compile>) {
  expect(d.pages.length).toBeGreaterThanOrEqual(1);
  expect(d.pages.length).toBeLessThanOrEqual(CHAT_MAX_PAGES);
  expect(d.containers).toBe(d.pages[0]);
  for (const page of d.pages) {
    expect(page.length).toBeLessThanOrEqual(CHAT_MAX_CONTAINERS);
    let y = TOP;
    for (const c of page) {
      expect(c.kind).toBe("text");
      expect(c.y).toBeGreaterThanOrEqual(y);
      expect(c.y + c.h).toBeLessThanOrEqual(BOTTOM);
      y = c.y + c.h;
    }
  }
}

const AGENTS = [
  { id: "h", type: "heading", text: "Your agents" },
  { id: "d", type: "divider" },
  { id: "l", type: "list", items: ["Orchestrator - thinking", "Codex - running tests", "Research Bot - idle", "Scout - waiting on you"] },
];

describe("chat display fit", () => {
  it("draws an info list as text lines, never a G2 list (no selection border)", () => {
    const d = compile([{ id: "l", type: "list", items: ["a", "b"] }]);
    expectFits(d);
    expect(d.containers).toEqual([expect.objectContaining({ block_id: "l", kind: "text", content: "─ a\n─ b" })]);
  });

  it("the reported case (heading, divider, 4-row info list) stays inside the chat area, continuing on page 2", () => {
    const d = compile(AGENTS);
    expectFits(d);
    expect(d.fallback).toBe(false);
    expect(d.pages.length).toBe(2);
    const shown = d.pages.flat().filter((c) => c.block_id === "l").map((c) => c.content).join("\n");
    expect(shown).toBe("─ Orchestrator - thinking\n─ Codex - running tests\n─ Research Bot - idle\n─ Scout - waiting on you");
  });

  it("a long list, table and fields continue on further pages with every row kept", () => {
    const items = Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`);
    const d = compile([
      { id: "t", type: "heading", text: "Report" },
      { id: "l", type: "list", items },
      { id: "tb", type: "table", columns: ["Job", "State"], rows: Array.from({ length: 6 }, (_, i) => [`job${i}`, "ok"]) },
      { id: "f", type: "fields", rows: Array.from({ length: 5 }, (_, i) => ({ label: `k${i}`, value: `v${i}` })) },
    ]);
    expectFits(d);
    expect(d.pages.length).toBeGreaterThan(1);
    const text = d.pages.flat().map((c) => c.content).join("\n");
    for (const i of items) expect(text).toContain(`─ ${i}`);
    expect(text).toContain("job5 · ok");
    expect(text).toContain("k4: v4");
  });

  it("a paragraph taller than the area splits by word and keeps two lines on each side", () => {
    const d = compile([{ id: "p", type: "text", content: "word ".repeat(150).trim() }]);
    expectFits(d);
    expect(d.pages.length).toBeGreaterThan(1);
    expect(d.pages.flat().map((c) => c.content).join(" ").split(" ")).toHaveLength(150);
    for (const page of d.pages) for (const c of page) expect(c.h).toBeGreaterThanOrEqual(2 * 27 + 8);
  });

  it("more than six blocks continue on the next page", () => {
    const d = compile(Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, type: "text", content: `line ${i}` })));
    expectFits(d);
    expect(d.pages.flat()).toHaveLength(8);
  });

  it("past the page cap the ladder halves rows (+N more)", () => {
    const d = compile(Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, type: "list", items: Array.from({ length: 20 }, (_, k) => `row ${k}`) })));
    expectFits(d);
    expect(d.fallback).toBe(false);
    expect(d.pages.flat().map((c) => c.content).join("\n")).toMatch(/\+\d+ more/);
  });

  it("the text fallback is paged too, never taller than the area", () => {
    const d = compile([{ id: "t", type: "text", content: "word ".repeat(60).trim(), lines: 1 }, { id: "c", type: "choice", options: [{ label: "Yes" }, { label: "No" }] }]);
    expect(d.fallback).toBe(true);
    expectFits(d);
    expect(d.pages.flat().every((c) => c.block_id === "fallback")).toBe(true);
    expect(d.pages.flat().map((c) => c.content).join("\n")).toContain("▶ Yes\n▶ No");
    expect(d.options?.items).toEqual(["Yes", "No"]);
  });
});
