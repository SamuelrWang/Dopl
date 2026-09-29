import { describe, expect, it } from "vitest";
import { compileScreen } from "./compile";
import { CONTENT_H, LINE_H, LIST_ROW_H, MARGIN, NAV_FOOTER, PAD, SCREEN_H, SCREEN_W, capabilities } from "./display";
import { renderPreview } from "./preview";

const ok = (spec: unknown) => {
  const r = compileScreen(spec, "s1");
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.payload;
};
const errs = (spec: unknown) => {
  const r = compileScreen(spec, "s1");
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};

const FOUR = {
  blocks: [
    { type: "text", id: "title", content: "Deploy — prod \u{1F680}" },
    { type: "progress", id: "bar", value: 0.5, label: "Build" },
    { type: "divider" },
    { type: "list", id: "act", items: ["Approve", "Hold"] },
  ],
};

describe("stack layout", () => {
  it("positions blocks top-down inside the margins", () => {
    const p = ok(FOUR);
    expect(p).toMatchObject({ screen_id: "s1", spec_version: 1 });
    const [title, bar, div, list] = p.containers;
    expect(title).toMatchObject({ block_id: "title", kind: "text", x: MARGIN, y: MARGIN, w: SCREEN_W - 2 * MARGIN, h: LINE_H + 2 * PAD });
    expect(title.content).toBe("Deploy - prod");
    expect(bar.y).toBe(title.y + title.h);
    expect(div.block_id).toBe("b3");
    expect(list).toMatchObject({ kind: "list", items: ["Approve", "Hold"], h: 2 * LIST_ROW_H + 2 * PAD });
    for (const c of p.containers) expect(c.y + c.h).toBeLessThanOrEqual(SCREEN_H);
  });

  it("measures wrapped text height with the G2 font", () => {
    const p = ok({ blocks: [{ type: "text", content: "word ".repeat(40) }] });
    expect(p.containers[0].h).toBeGreaterThan(2 * LINE_H);
    expect((p.containers[0].h - 2 * PAD) % LINE_H).toBe(0);
  });

  it("reports overflow with a fix, never truncates", () => {
    const e = errs({ blocks: Array.from({ length: 8 }, () => ({ type: "text", content: "long line ".repeat(20) })) });
    expect(e[0].code).toBe("overflow");
    expect(e[0].message).toMatch(/^stack height \d+px > 248px \(the bottom 40px is the back button\); remove \d+ line\(s\) or shorten b\d$/);
  });

  it("shrinks a long list (it scrolls) before calling overflow", () => {
    const p = ok({
      blocks: [
        { type: "text", content: "Pick one" },
        { type: "list", items: Array.from({ length: 19 }, (_, i) => `Option ${i}`) },
      ],
    });
    const list = p.containers[1];
    expect(list.items).toHaveLength(19);
    expect(list.y + list.h).toBe(CONTENT_H - MARGIN);
  });

  it("reserves the bottom band for the plugin's back button on every screen", () => {
    const p = ok({ blocks: [{ type: "text", content: "hi" }] });
    expect(p.nav_footer).toEqual({ x: 0, y: SCREEN_H - 40, w: SCREEN_W, h: 40 });
    const tall = ok({ blocks: Array.from({ length: 6 }, () => ({ type: "text", content: "one line" })) });
    for (const c of tall.containers) expect(c.y + c.h).toBeLessThanOrEqual(NAV_FOOTER.y);
    const caps = capabilities();
    expect(caps.content).toEqual({ width: SCREEN_W, height: CONTENT_H });
    expect(caps.limits.selectable_list_items).toBe(19);
  });

  it("caps a selectable list at 19 (the 20th row is the back item); a plain list keeps 20", () => {
    const items = Array.from({ length: 20 }, (_, i) => `o${i}`);
    expect(errs({ blocks: [{ type: "list", items }] })[0]).toMatchObject({
      code: "list_too_long",
      message: "20 items; max 19 in a selectable list (the 20th row is the back button)",
    });
    // A plain list validates at 20, but it is text on the lens: 20 lines do not fit, so it is overflow, not hidden rows.
    expect(errs({ blocks: [{ type: "text", content: "a" }, { type: "list", items, selectable: false }] }).map((e) => e.code)).toEqual(["overflow"]);
  });

  it("draws an info list as text lines (no G2 list, no selection border) and keeps it above the back button", () => {
    const p = ok({ blocks: [{ type: "text", content: "Agents" }, { type: "list", id: "info", items: ["Orchestrator - thinking", "Scout - idle"], selectable: false }] });
    expect(p.containers[1]).toMatchObject({ block_id: "info", kind: "text", content: "─ Orchestrator - thinking\n─ Scout - idle", h: 2 * LINE_H + 2 * PAD });
    expect(p.containers.every((c) => c.kind === "text")).toBe(true);
  });

  it("measures selectable list rows at the firmware's 40px, so a stack with a list never reaches the back button", () => {
    const p = ok({
      blocks: [
        { type: "text", content: "word ".repeat(30) },
        { type: "list", items: ["a", "b", "c", "d"] },
      ],
    });
    for (const c of p.containers) expect(c.y + c.h).toBeLessThanOrEqual(NAV_FOOTER.y);
    const list = p.containers[1];
    expect(list.h).toBeGreaterThanOrEqual(2 * LIST_ROW_H + 2 * PAD);
  });

  it("rejects absolute blocks that reach into the back-button band", () => {
    const e = errs({ layout: "absolute", blocks: [{ type: "text", content: "hi", x: 0, y: 230, w: 200, h: 40 }] });
    expect(e[0]).toMatchObject({ block: "b1", code: "overlaps_nav_footer" });
    expect(e[0].message).toContain("shrink h by 22px");
  });

  it("flags a text that wraps past its fixed lines", () => {
    const e = errs({ blocks: [{ type: "text", id: "t", content: "word ".repeat(60), lines: 1 }] });
    expect(e[0]).toMatchObject({ block: "t", code: "overflow" });
  });
});

describe("compiled block kinds", () => {
  it("progress becomes one text line of G2-safe glyphs", () => {
    const bar = ok(FOUR).containers[1];
    expect(bar.content).toMatch(/^Build █+▒+ 50%$/);
    expect(bar.content).not.toMatch(/[░▓▮]/);
  });

  it("divider is a row of box-drawing dashes, spacer adds no container", () => {
    const p = ok({ blocks: [{ type: "text", content: "a" }, { type: "spacer", lines: 2 }, { type: "divider" }] });
    expect(p.containers).toHaveLength(2);
    expect(p.containers[1].content).toMatch(/^─+$/);
    expect(p.containers[1].y).toBe(MARGIN + LINE_H + 2 * PAD + 2 * LINE_H);
  });
});

describe("the one-capture rule", () => {
  it("gives capture to the selectable list", () => {
    const caps = ok(FOUR).containers.filter((c) => c.capture);
    expect(caps.map((c) => c.block_id)).toEqual(["act"]);
  });

  it("falls back to the last text container", () => {
    const p = ok({ blocks: [{ type: "text", content: "a" }, { type: "text", id: "z", content: "b" }, { type: "list", items: ["x"], selectable: false }] });
    // The info list is drawn as text but is not the agent's text block.
    expect(p.containers.filter((c) => c.capture).map((c) => c.block_id)).toEqual(["z"]);
  });

  it("rejects two selectable lists", () => {
    const e = errs({ blocks: [{ type: "list", items: ["a"] }, { type: "list", items: ["b"] }] });
    expect(e[0].code).toBe("multiple_selectable");
  });
});

describe("validation codes", () => {
  it.each([
    [{ blocks: Array.from({ length: 13 }, () => ({ type: "spacer" })) }, "too_many_blocks"],
    [{ blocks: Array.from({ length: 9 }, () => ({ type: "text", content: "a" })) }, "too_many_blocks"],
    [{ blocks: [{ type: "text", content: "x".repeat(961) }] }, "text_too_long"],
    [{ blocks: [{ type: "list", items: Array.from({ length: 21 }, () => "a") }] }, "list_too_long"],
    [{ blocks: [{ type: "list", items: ["x".repeat(64)] }] }, "item_too_long"],
    [{ blocks: [{ type: "progress", value: 2 }] }, "bad_value"],
    [{ blocks: [{ type: "text", content: "a", brightness: 9 }] }, "bad_value"],
    [{ blocks: [{ type: "banner" }] }, "bad_value"],
    [{ blocks: [{ type: "text", content: "a", x: 5 }] }, "bad_value"],
    [{ layout: "absolute", blocks: [{ type: "text", content: "a", x: 500, y: 0, w: 100 }] }, "out_of_bounds"],
    [{ layout: "absolute", blocks: [{ type: "text", content: "word ".repeat(30), x: 0, y: 0, w: 200, h: 40 }] }, "overflow"],
  ])("%j -> %s", (spec, code) => {
    expect(errs(spec).map((e) => e.code)).toContain(code);
  });
});

describe("absolute layout", () => {
  it("keeps the agent's coordinates", () => {
    const p = ok({ layout: "absolute", blocks: [{ type: "text", content: "hi", x: 20, y: 100, w: 200, h: 40 }] });
    expect(p.containers[0]).toMatchObject({ x: 20, y: 100, w: 200, h: 40, capture: true });
  });
});

describe("preview", () => {
  it("draws an ASCII mock with block ids and the capture mark", () => {
    const compiled = ok(FOUR);
    const preview = renderPreview(compiled);
    const rows = preview.split("\n");
    expect(rows).toHaveLength(18);
    expect(preview).toContain("< [back button]");
    expect(rows[0]).toBe("+" + "-".repeat(64) + "+");
    expect(preview).toContain("[title] Deploy - prod");
    expect(preview).toContain("[bar] Build #");
    expect(preview).toContain("[act*] > Approve");
    expect(preview).toMatch(/^[\x20-\x7E\n]+$/);
  });
});

describe("preview of multi-line text", () => {
  it("keeps each line and never cuts the first under its tag", () => {
    const res = compileScreen({ blocks: [{ id: "t", type: "text", content: "Risk: Low\nETA: 10 min" }] }, "s");
    if (!res.ok) throw new Error("compile failed");
    const rows = renderPreview(res.payload).split("\n");
    expect(rows.some((r) => r.includes("[t*] Risk: Low"))).toBe(true);
    expect(rows.some((r) => r.includes("| ETA: 10 min"))).toBe(true);
  });
});
