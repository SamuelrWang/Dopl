import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PENDING_ATTR, PENDING_ROW, PendingRow, pendingRow } from "./pending";

describe("PENDING_ROW", () => {
  it("dims the row and takes its pointer events away", () => {
    expect(PENDING_ROW).toContain("opacity-60");
    expect(PENDING_ROW).toContain("pointer-events-none");
  });

  it("is tokens only — no hex colors, no raw px", () => {
    expect(PENDING_ROW).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(PENDING_ROW).not.toMatch(/\d+px/);
  });
});

describe("pendingRow", () => {
  it("adds the class and the data attribute only while pending", () => {
    const on = pendingRow(true, "rounded-[10px] border");
    expect(on.className).toContain("opacity-60");
    expect(on[PENDING_ATTR]).toBe("");

    const off = pendingRow(false, "rounded-[10px] border");
    expect(off.className).toBe("rounded-[10px] border");
    expect(PENDING_ATTR in off).toBe(false);
  });

  it("keeps the row's own classes — it composes, it does not restyle", () => {
    expect(pendingRow(true, "bg-bg-elevated").className).toContain(
      "bg-bg-elevated"
    );
  });
});

describe("PendingRow", () => {
  it("renders its children inside a marked shell", () => {
    const html = renderToStaticMarkup(
      createElement(PendingRow, { className: "bento" }, "not saved yet")
    );
    expect(html).toContain('data-pending=""');
    expect(html).toContain("opacity-60");
    expect(html).toContain("not saved yet");
  });

  it("is inert when told the row is settled", () => {
    const html = renderToStaticMarkup(
      createElement(PendingRow, { pending: false, className: "bento" }, "saved")
    );
    expect(html).not.toContain("data-pending");
    expect(html).not.toContain("opacity-60");
  });
});
