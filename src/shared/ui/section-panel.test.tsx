// @vitest-environment jsdom
/**
 * THE FLAT SECTION — its shape, and the page hook that grounds it.
 *
 * ⚠ THE SECOND DESCRIBE IS A SOURCE READ. The /home ground is a CSS-module
 * rule, and jsdom loads no stylesheet: a rendered assertion would report the
 * same nothing for a grounded panel and an ungrounded one. Same shape as
 * `features/agent-templates/components/template-editor.test.tsx › no concave
 * surfaces`, and it reaches across trees the same way — a `readFileSync` from
 * the repo root, no import and no second config.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SectionPanel } from "./section-panel";

afterEach(cleanup);

describe("what a flat section is", () => {
  it("paints NOTHING of its own — the ground is the caller's", () => {
    // ⚠ THE WHOLE SCOPING STORY. /home's palette is that page's alone, so a
    // shared component must not be able to reach it; the caller (or a
    // page-scoped rule) supplies fill and border, and this asserts the default
    // carries neither.
    render(
      <SectionPanel id="s" label="Personal">
        <p>body</p>
      </SectionPanel>
    );
    const panel = screen.getByRole("region", { name: "Personal" });
    expect(panel.className).not.toMatch(/\bbg-/);
    expect(panel.className).not.toMatch(/\bborder/);
  });

  it("puts the heading, the caption and the content on ONE ground", () => {
    // No header strip, no nested well: three children of one section, in order.
    render(
      <SectionPanel id="s" label="Personal" caption="Yours alone." action={<button>New</button>}>
        <p>a card</p>
      </SectionPanel>
    );
    const panel = screen.getByRole("region", { name: "Personal" });
    const heading = screen.getByRole("heading", { name: "Personal" });
    expect(heading.className).toContain("uppercase");
    // The action rides in the heading's own row, not in a band of its own.
    expect(heading.parentElement).toContain(screen.getByRole("button", { name: "New" }));
    expect(panel.textContent).toContain("Yours alone.");
    expect(panel.textContent).toContain("a card");
  });

  it("keeps its header when it is empty", () => {
    render(<SectionPanel id="s" label="Personal">{null}</SectionPanel>);
    expect(screen.getByRole("heading", { name: "Personal" })).toBeTruthy();
  });

  it("carries the page-scoping attribute", () => {
    render(<SectionPanel id="s" label="Personal">{null}</SectionPanel>);
    expect(
      screen.getByRole("region", { name: "Personal" }).hasAttribute("data-section-panel")
    ).toBe(true);
  });
});

describe("the /home ground", () => {
  /**
   * ⚠ BOTH HALVES OR NEITHER. The attribute above is inert without the rule,
   * and the rule is dead the moment the attribute is renamed — and a dead
   * repaint looks like a design change nobody made, on a page nobody was
   * editing. The two are asserted together, in the direction Samuel ruled
   * (2026-08-27): the record pane's sections are FLAT and wear the page's own
   * panel gray, so Knowledge and Agents cannot diverge.
   */
  it("repaints every section panel in the record pane, in ONE rule", () => {
    const css = readFileSync(
      path.join(
        process.cwd(),
        "apps",
        "desktop-ui",
        "src",
        "pages",
        "home",
        "home.module.css"
      ),
      "utf8"
    );
    expect(css).toContain(".frame :global([data-section-panel])");
    // The page palette, never a literal — `--home-panel` is the fill the
    // relationship list stands on (`docs/DESIGN-SYSTEM.md`, /home ONLY).
    const rule = css.slice(css.indexOf(".frame :global([data-section-panel])"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toContain("var(--home-panel)");
    // FLAT: the hairline `TemplatePanel` wears on the workspace Agents page is
    // taken off here rather than left showing on one of the two faces.
    expect(body).toContain("border-color: transparent");
  });
});
