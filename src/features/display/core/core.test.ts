import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";
import { normalizeDisplay, fromV1 } from "./normalize";
import { displayFallback } from "./fallback";
import { decisionIndexOf, displayFromEscalation, displayOf } from "./adapt";
import { answerersOf } from "./answerers";
import { parseStoredEscalation, type ChannelEscalationInput } from "@/features/channels/escalation";

const ok = (input: unknown, version?: 1 | 2) => {
  const r = normalizeDisplay(input, { version });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.display;
};
const codes = (input: unknown) => {
  const r = normalizeDisplay(input);
  return r.ok ? [] : r.errors.map((e) => e.code);
};
const rep = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));

describe("normalizeDisplay", () => {
  it("accepts every block and defaults ids by position", () => {
    const d = ok({
      blocks: [
        { type: "heading", text: " Ship? " },
        { type: "text", content: "a\nb", tone: "muted" },
        { type: "fields", rows: [{ label: "Risk", value: "Low" }, { label: "Count", value: 3 }] },
        { type: "list", items: ["x"], style: "number" },
        { type: "choice", id: "ship", options: [{ label: "Now", recommended: true, why: "safe" }, "Later"] },
        { type: "progress", value: 0.5, label: "Build" },
        { type: "table", columns: ["a", "b"], rows: [["1", 2]] },
        { type: "divider" },
        { type: "spacer", lines: 2 },
      ],
    });
    expect(d.blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "ship", "b6", "b7", "b8", "b9"]);
    expect(d.blocks[0]).toEqual({ id: "b1", type: "heading", text: "Ship?" });
    expect(d.blocks[2]).toMatchObject({ rows: [{ label: "Risk", value: "Low" }, { label: "Count", value: "3" }] });
    expect(d.blocks[4]).toEqual({
      id: "ship",
      type: "choice",
      options: [{ label: "Now", recommended: true, why: "safe" }, { label: "Later" }],
    });
    expect(d.layout).toBe("stack");
  });

  it.each([
    [{ blocks: [] }, "bad_value"],
    [{ blocks: rep(25, () => ({ type: "divider" })) }, "too_many_blocks"],
    [{ blocks: [{ type: "heading", text: "x".repeat(121) }] }, "text_too_long"],
    [{ blocks: [{ type: "heading", text: "a\nb" }] }, "bad_value"],
    [{ blocks: [{ type: "text", content: "x".repeat(2001) }] }, "text_too_long"],
    [{ blocks: [{ type: "text", content: "x", color: "red" }] }, "unknown_key"],
    [{ blocks: [{ type: "text", content: "x", x: 1 }] }, "unknown_key"],
    [{ blocks: [{ type: "fields", rows: rep(13, () => ({ label: "a", value: "b" })) }] }, "list_too_long"],
    [{ blocks: [{ type: "fields", rows: [{ label: "x".repeat(41), value: "b" }] }] }, "text_too_long"],
    [{ blocks: [{ type: "list", items: rep(21, () => "i") }] }, "list_too_long"],
    [{ blocks: [{ type: "choice", options: ["only"] }] }, "bad_value"],
    [{ blocks: [{ type: "choice", options: rep(13, (i) => `o${i}`) }] }, "list_too_long"],
    [{ blocks: [{ type: "choice", options: ["a", "b"] }, { type: "choice", options: ["c", "d"] }] }, "multiple_choice"],
    [{ blocks: [{ type: "choice", options: [{ label: "a", recommended: true }, { label: "b", recommended: true }] }] }, "bad_recommendation"],
    [{ blocks: [{ type: "choice", options: [{ label: "a", why: "no" }, "b"] }] }, "bad_recommendation"],
    [{ blocks: [{ type: "progress", value: 1.5 }] }, "bad_value"],
    [{ blocks: [{ type: "table", columns: ["a"], rows: [["1"]] }] }, "bad_value"],
    [{ blocks: [{ type: "table", columns: ["a", "b"], rows: [["1"]] }] }, "table_shape"],
    [{ blocks: [{ type: "table", columns: ["a", "b"], rows: rep(11, () => ["1", "2"]) }] }, "list_too_long"],
    [{ blocks: [{ type: "spacer", lines: 5 }] }, "bad_value"],
    [{ blocks: [{ type: "divider", id: "a" }, { type: "divider", id: "a" }] }, "duplicate_id"],
    [{ blocks: [{ type: "image", url: "x" }] }, "bad_value"],
  ])("refuses %j with %s", (input, code) => {
    expect(codes(input)).toContain(code);
  });

  it("keeps geometry only on absolute layouts", () => {
    const d = ok({ layout: "absolute", blocks: [{ type: "text", content: "x", x: 8, y: 8, w: 100 }] });
    expect(d.blocks[0]).toMatchObject({ x: 8, y: 8, w: 100 });
    expect(codes({ layout: "absolute", blocks: [{ type: "text", content: "x" }] })).toContain("bad_value");
  });

  it("reads a v2 selectable list as a choice and ignores selectable:false", () => {
    const d = ok({ blocks: [{ type: "list", items: ["a", "b"], selectable: true }, { type: "list", items: ["c"], selectable: false }] });
    expect(d.blocks.map((b) => b.type)).toEqual(["choice", "list"]);
  });

  it("fromV1: selectable (default) list → choice, info list → list", () => {
    expect(fromV1([{ type: "list", id: "o", items: ["a", "b"] }, { type: "list", items: ["c"], selectable: false }])).toEqual([
      { type: "choice", id: "o", options: [{ label: "a" }, { label: "b" }] },
      { type: "list", items: ["c"] },
    ]);
    expect(normalizeDisplay({ blocks: [{ type: "list", items: ["a", "b"] }, { type: "list", items: ["c", "d"] }] }, { version: 1 }))
      .toMatchObject({ ok: false, errors: [{ code: "multiple_choice" }] });
  });
});

describe("displayFallback", () => {
  it("renders every block as text", () => {
    const d = ok({
      blocks: [
        { type: "heading", text: "H" },
        { type: "fields", rows: [{ label: "Risk", value: "Low" }] },
        { type: "list", items: ["a"] },
        { type: "list", items: ["b"], style: "number" },
        { type: "choice", options: [{ label: "Now", description: "fast", recommended: true, why: "safe" }, "Later"] },
        { type: "progress", value: 0.32, label: "Build" },
        { type: "table", columns: ["a", "b"], rows: [["1", "2"]] },
        { type: "divider" },
      ],
    });
    expect(displayFallback(d.blocks)).toBe(
      ["H", "Risk: Low", "- a", "1. b", "1. Now — fast (recommended)", "2. Later", "Recommended: 1. Now — safe", "Build 32%", "a | b", "1 | 2", "---"].join("\n")
    );
    expect(displayFallback([{ id: "s", type: "spacer" }])).toBe("Display");
  });
});

const MCP_RENDER = path.join(import.meta.dirname, "..", "..", "..", "..", "packages", "mcp-server", "dist", "tools", "channel-escalate-render.js");
const CASES = (createRequire(import.meta.url)(MCP_RENDER) as { ESCALATION_BODY_PARITY_CASES: ChannelEscalationInput[] })
  .ESCALATION_BODY_PARITY_CASES;

describe("decision adapter", () => {
  it.each(CASES.map((c) => [c.issue, c]))("round-trips %s through display → decision index", (_, input) => {
    const e = parseStoredEscalation(input)!;
    const blocks = displayFromEscalation(e);
    expect(normalizeDisplay({ blocks }).ok).toBe(true);
    expect(decisionIndexOf(blocks)).toEqual({ ...input, context: input.context ?? "", recommendation: input.recommendation ?? null });
  });

  it("indexes a composed display: heading issue, rest as context, relaxed options", () => {
    const d = ok({
      blocks: [
        { type: "heading", text: "Ship?" },
        { type: "text", content: "CI green." },
        { type: "choice", options: [{ label: "Now", recommended: true }, "Later"] },
      ],
    });
    const index = decisionIndexOf(d.blocks)!;
    expect(index).toEqual({
      issue: "Ship?",
      context: "CI green.",
      options: [{ label: "Now", consequence: "" }, { label: "Later", consequence: "" }],
      recommendation: { index: 0, why: "" },
    });
    expect(parseStoredEscalation(index)).not.toBeNull();
    expect(decisionIndexOf([{ id: "t", type: "text", content: "no choice" }])).toBeNull();
  });
});

describe("displayOf", () => {
  const v2 = { spec_version: 2, display_id: "d-1", blocks: [{ id: "c", type: "choice", options: [{ label: "a" }, { label: "b" }] }] };

  it("reads v2, with its stamp", () => {
    const stamp = { block_id: "c", index: 1, choice: "b", at: "t", via: "glasses", by: "u1", message_id: "m1" };
    expect(displayOf({ display: { ...v2, answer: stamp, wait_until: "w" }, escalation: {} })).toMatchObject({
      from: "v2",
      display_id: "d-1",
      answer: stamp,
      wait_until: "w",
      decision: true,
    });
  });

  it("reads v1 (screen_id, selectable list, null block id)", () => {
    const d = displayOf({
      display: { spec_version: 1, screen_id: "s-1", blocks: [{ id: "o", type: "list", items: ["a", "b"], selectable: true, border: false }], answer: { block_id: null, choice: "a", index: 0, at: "t", via: "web" } },
    });
    expect(d).toMatchObject({ from: "v1", display_id: "s-1", decision: false, answer: { block_id: "o", index: 0 } });
    expect(d?.blocks[0].type).toBe("choice");
  });

  it("falls through a garbage display to the escalation, then to null", () => {
    const escalation = { issue: "Q", context: "", options: [{ label: "a", consequence: "x" }, { label: "b", consequence: "y" }] };
    const page = { block_id: "decision", index: 0, choice: "a", at: "t", via: "web" };
    expect(displayOf({ display: { spec_version: 2, blocks: [{ type: "nope" }] }, escalation }, { pageAnswer: page })).toMatchObject({
      from: "escalation",
      answer: page,
      decision: true,
    });
    expect(displayOf({ display: { spec_version: 9, blocks: [] } })).toBeNull();
    expect(displayOf(null)).toBeNull();
  });
});

describe("answerersOf", () => {
  it("is the tagged set, else the author", () => {
    expect(answerersOf({ mentionedUserIds: ["a", "b"] }, "c")).toEqual(["a", "b"]);
    expect(answerersOf({}, "c")).toEqual(["c"]);
    expect(answerersOf(null, null)).toEqual([]);
  });
});
