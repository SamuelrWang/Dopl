import { describe, expect, it } from "vitest";
import { fitLens, toLensPrimitives } from "./degrade";
import { normalizeDisplay } from "./normalize";
import { checkTemplateSpec, fillTemplate, templateSpecOf, templateVariables } from "./template";

const blocksOf = (blocks: unknown[]) => {
  const r = normalizeDisplay({ blocks });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.display.blocks;
};
const OPTS = { itemBytes: 63 };

describe("toLensPrimitives", () => {
  const blocks = blocksOf([
    { type: "heading", text: "Ship?" },
    { type: "text", content: "quiet", tone: "muted" },
    { type: "fields", rows: [{ label: "Risk", value: "Low" }, { label: "ETA", value: "10m" }] },
    { type: "list", items: ["a", "b"], style: "number" },
    { type: "table", columns: ["Job", "State"], rows: [["web", "done"]] },
    { type: "divider" },
    { type: "spacer" },
    { type: "choice", id: "c", options: [{ label: "Now", description: "fast", recommended: true, why: "safe" }, { label: "Later" }] },
  ]);

  it("maps every block on the screen", () => {
    const { blocks: p, options } = toLensPrimitives(blocks, { ...OPTS, mode: "screen", level: 0 });
    expect(options).toBeNull();
    expect(p).toEqual([
      { id: "b1", type: "text", content: "Ship?", brightness: 4 },
      { id: "b2", type: "text", content: "quiet", brightness: 2 },
      { id: "b3", type: "text", content: "Risk: Low\nETA: 10m" },
      { id: "b4", type: "list", items: ["1. a", "2. b"], selectable: false },
      { id: "b5", type: "text", content: "Job · State\nweb · done" },
      { id: "b6", type: "divider" },
      { id: "b7", type: "spacer" },
      { id: "n_c", type: "text", content: "Now: fast\nRecommended: Now - safe", brightness: 2 },
      { id: "c", type: "list", items: ["Now (rec)", "Later"], selectable: true },
    ]);
  });

  it("puts the choice apart in chat mode and walks the ladder", () => {
    const chat = toLensPrimitives(blocks, { ...OPTS, mode: "chat", level: 3 });
    expect(chat.options).toEqual({ block_id: "c", items: ["Now (rec)", "Later"], recommended: 0 });
    expect(chat.blocks.map((b) => b.type)).not.toContain("divider");
    expect(chat.blocks.map((b) => b.id)).not.toContain("n_c");
    const halved = toLensPrimitives(blocks, { ...OPTS, mode: "chat", level: 4 });
    expect(halved.blocks.find((b) => b.id === "b3")?.content).toBe("Risk: Low\n+1 more");
  });

  it("fitLens returns the first level that compiles", () => {
    const res = fitLens(blocks, "stack", { ...OPTS, mode: "screen" }, (p) =>
      p.blocks.some((b) => b.type === "divider") ? { ok: false, errors: ["too tall"] } : { ok: true, payload: p.blocks.length }
    );
    expect(res).toMatchObject({ ok: true, level: 3 });
    expect(fitLens(blocks, "absolute", { ...OPTS, mode: "screen" }, () => ({ ok: false, errors: ["x"] }))).toEqual({ ok: false, level: 0, errors: ["x"] });
  });
});

describe("templates", () => {
  it("keeps v1 input v1 (a one-item selectable list stays valid) and spreads arrays", () => {
    const stored = checkTemplateSpec({ blocks: [{ type: "list", items: ["{{opts}}"] }, { type: "progress", value: "{{pct}}" }] }, 1);
    expect(stored).not.toHaveProperty("spec_version");
    expect(templateVariables(stored)).toEqual(["opts", "pct"]);
    const spec = templateSpecOf(stored);
    expect(spec.version).toBe(1);
    const one = fillTemplate(spec, { opts: ["Continue"], pct: 0.5 }) as { blocks: unknown[] };
    expect(normalizeDisplay(one, { version: 1 }).ok).toBe(true);
    expect(() => fillTemplate(stored, {})).toThrow(/missing template data: opts, pct/);
  });

  it("stores v2 with spec_version 2 and spreads an array into choice options", () => {
    const stored = checkTemplateSpec({ blocks: [{ type: "choice", options: [{ label: "{{opts}}" }] }] });
    expect(stored.spec_version).toBe(2);
    const filled = fillTemplate(templateSpecOf(stored), { opts: ["a", "b"] }) as { blocks: unknown[] };
    expect(filled.blocks[0]).toEqual({ type: "choice", options: [{ label: "a" }, { label: "b" }] });
  });
});
