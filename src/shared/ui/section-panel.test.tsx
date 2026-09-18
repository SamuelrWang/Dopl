// @vitest-environment jsdom
/**
 * THE FLAT SECTION — its shape, and the page hook that grounds it.
 *
 * ⚠ THE GROUND IS THE COMPONENT'S OWN SINCE R-38/R-39 (2026-09-17), so it is
 * asserted by RENDER and not by a source read any more. It was a `:global()`
 * rule fenced to /home's record pane (`pages/home/home.module.css › .frame`)
 * while a workspace page passed a ground carrying a hairline; one flat gray on
 * both hosts has one place to be stated.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SECTION_PANEL_GROUND, SectionPanel } from "./section-panel";
import { SECTION_HEADING_TEXT } from "./section-heading";

afterEach(cleanup);

describe("what a flat section is", () => {
  it("paints ONE flat ground, on every host", () => {
    // 🔒 R-38 + R-39 (Samuel, 2026-09-17): the workspace adopts /home's skin and
    // the section language is FLAT. This case asserted the OPPOSITE until then —
    // "paints NOTHING, the ground is the caller's" — which is what let a
    // hairline live on every page /home was not.
    render(
      <SectionPanel id="s" label="Personal">
        <p>body</p>
      </SectionPanel>
    );
    const panel = screen.getByRole("region", { name: "Personal" });
    for (const token of SECTION_PANEL_GROUND.split(" ")) {
      expect(panel.className).toContain(token);
    }
    // FLAT: a transparent border box, never a visible hairline — see the
    // constant's docblock for why the box stays.
    expect(panel.className).not.toMatch(/border-border-/);
  });

  it("still lets a caller override the ground", () => {
    render(
      <SectionPanel id="s" label="Personal" className="bg-home-card">
        <p>body</p>
      </SectionPanel>
    );
    // `cn` is tailwind-merge: the later `bg-*` wins, so an override is one prop
    // and not a `tone` enum.
    const panel = screen.getByRole("region", { name: "Personal" });
    expect(panel.className).toContain("bg-home-card");
    expect(panel.className).not.toContain("bg-home-panel");
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
    // 🔒 THE SECTION HEADING TYPE (Samuel, 2026-09-13: the /home "Usage" trial
    // "applied to each of the headers for each section") — `section-heading.ts`,
    // by import; no uppercase label strip any more.
    for (const token of SECTION_HEADING_TEXT.split(" ")) {
      expect(heading.className).toContain(token);
    }
    expect(heading.className).not.toMatch(/\buppercase\b|text-label/);
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

describe("the hook survives the rule that used it", () => {
  /**
   * ⚠ THE ATTRIBUTE OUTLIVED ITS `:global()` RULE ON PURPOSE (R-38, 2026-09-17).
   * It is what let a page repaint every panel at once, and the day another host
   * needs that it is the difference between one rule and a sweep of call sites.
   * Asserted here so "no rule reads it" never becomes "so delete it".
   */
  it("is still on the section, and no kit copy claims it", () => {
    render(<SectionPanel id="s" label="Personal">{null}</SectionPanel>);
    expect(
      screen.getByRole("region", { name: "Personal" }).hasAttribute("data-section-panel")
    ).toBe(true);
    for (const rel of [
      "src/app/globals.css",
      "apps/desktop-ui/src/styles/kit.css",
      "apps/desktop-ui/src/pages/home/home.module.css",
    ]) {
      const css = readFileSync(path.join(process.cwd(), rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, `${rel} took the scoped repaint back`).not.toContain(
        "[data-section-panel]"
      );
    }
  });
});
