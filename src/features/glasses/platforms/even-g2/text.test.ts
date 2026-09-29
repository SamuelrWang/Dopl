import { describe, expect, it } from "vitest";
import { sanitizeG2Text, wrapCardLines } from "./text";

describe("sanitizeG2Text", () => {
  it("straightens curly quotes and flattens dashes", () => {
    expect(sanitizeG2Text("“Hi” it’s 3–4 — ok")).toBe(
      "\"Hi\" it's 3-4 - ok",
    );
  });

  it("strips emoji, non-BMP chars, variation selectors and ZWJ", () => {
    expect(sanitizeG2Text("Deploy \u{1F680} done ✅️ \u{1F468}‍\u{1F4BB}")).toBe(
      "Deploy done",
    );
  });

  it("keeps plain accented latin", () => {
    expect(sanitizeG2Text("café naïve")).toBe("café naïve");
  });

  it("expands ellipsis and collapses spaces", () => {
    expect(sanitizeG2Text("  wait…   now ")).toBe("wait... now");
  });
});

describe("wrapCardLines", () => {
  const budget = { maxLines: 4, maxLineBytes: 100 };

  it("keeps short text whole", () => {
    expect(wrapCardLines("short reply", budget)).toEqual(["short reply"]);
  });

  it("clamps long text to the budget and marks the cut", () => {
    const lines = wrapCardLines("word ".repeat(200), budget);
    expect(lines).toHaveLength(4);
    expect(lines[3].endsWith("…")).toBe(true);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(100);
  });
});
