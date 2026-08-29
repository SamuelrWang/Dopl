// @vitest-environment jsdom
/**
 * THE COMPOSER PANELS' SHARED FIELD KIT — `composer-request-panel.tsx › PanelField`.
 *
 * ⚠ ITS OWN FILE SINCE 2026-08-27, at the 500-line cap. **The seam is the SUBJECT** (§1): the kit
 * is shared by BOTH panels, so its pins were landing half in `composer.test.tsx` (the thread
 * panel's) and half in `composer-launch.test.tsx` (the agent panel's) — two files asserting one
 * component, and neither the obvious place to add the next case.
 *
 * ⚠ IT RENDERS THE COMPONENT DIRECTLY, not through a composer. The kit takes no state, no bridge
 * and no roster; driving it through a panel would mount the whole send surface to assert a border.
 *
 * WHAT THIS FILE IS FOR — three properties, every one of which shipped WRONG once and was caught
 * by Samuel on the rendered app rather than by a test:
 *
 *   1. **The line is a real element inside the card's padding box.** It was a `border-b-*` on the
 *      card, composed over `RAISED_WELL`'s all-sides border, and rendered NOTHING VISIBLE — a 1px
 *      bottom edge on a `rounded-lg` raised face in the card's own border colour is swallowed by
 *      the radius and the elevation. **jsdom draws no borders**, so a class-name assertion can
 *      never see that; what it CAN check is structure, which is what these cases do.
 *   2. **Only TEXT entry is underlined.** The line is the app's edit affordance — it says "type
 *      here" — and a dropdown already states it is a control by being one.
 *   3. **The label has no fixed column.** `w-[84px]` put a wide dead gap after every short label.
 */

import { describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { PanelField } from "./composer-request-panel";

afterEach(cleanup);

/** ⚠ CLASS TOKENS, NEVER SUBSTRINGS. `border-border-default` CONTAINS "border-b", so a
 *  `toContain("border-b")` check answers true on a card that draws no bottom edge at all —
 *  measured, on the first version of these cases. */
const classes = (el: Element | null | undefined) =>
  (el?.className ?? "").split(/\s+/).filter(Boolean);
const drawsLine = (el: Element | null | undefined) => classes(el).includes("border-b");

describe("a TEXT field", () => {
  it("draws the line as its OWN node, spanning the label and the value", () => {
    render(
      <PanelField label="Name:">
        <input aria-label="Agent name" />
      </PanelField>
    );
    const line = screen.getByLabelText("Agent name").closest("[data-field-line]");
    expect(line).not.toBeNull();
    expect(drawsLine(line)).toBe(true);
    expect(classes(line)).toContain("border-border-strong");
    // ⚠ INK ONLY ON FOCUS, and `focus-within` is what makes that work from here: the focus lands
    // on the `<input>` one level down, so `focus:` would never fire.
    expect(classes(line)).toContain("focus-within:border-text-primary");
    // ⚠ THE LABEL IS INSIDE THE LINE — the whole point of moving it off the input.
    expect(line?.textContent).toContain("Name:");
  });

  it("puts the line INSIDE the card's padding, never on the card's own border", () => {
    // ⚠ THIS IS THE STRUCTURAL GUARD AGAINST THE INVISIBLE VERSION. A line on the card is a line
    // a radius can swallow; a line in the content box cannot be clipped by one.
    render(
      <PanelField label="Name:">
        <input aria-label="Agent name" />
      </PanelField>
    );
    const line = screen.getByLabelText("Agent name").closest("[data-field-line]");
    const card = line?.parentElement;
    expect(classes(card)).toContain("px-3");
    expect(drawsLine(card)).toBe(false);
  });

  it("gives the label no fixed column — the value starts right after the word", () => {
    render(
      <PanelField label="Description:">
        <input aria-label="Agent description" />
      </PanelField>
    );
    const label = screen.getByText("Description:");
    expect(label.className).not.toMatch(/\bw-\[/);
    expect(label.className).toContain("shrink-0");
  });
});

describe("a DROPDOWN row", () => {
  it("wears the same card and NO line", () => {
    render(
      <PanelField label="Model:" as="div" center line={false}>
        <button type="button">Default</button>
      </PanelField>
    );
    const row = screen.getByText("Model:").parentElement;
    // ⚠ THE HOOK IS ABSENT, WHICH IS WHAT MAKES THE ABSENCE ASSERTABLE. `data-field-line` is set
    // only where a line is, so a dropdown that grew one fails as loudly as a text field that
    // lost one.
    expect(row?.hasAttribute("data-field-line")).toBe(false);
    expect(drawsLine(row)).toBe(false);
    // …and it is still the same card, so the rows keep one face.
    expect(classes(row?.parentElement)).toContain("px-3");
  });

  it("centres its control against the label", () => {
    // A menu trigger is one line tall; `items-start` would hang it above the word.
    render(
      <PanelField label="Template:" as="div" center line={false}>
        <button type="button">Blank agent</button>
      </PanelField>
    );
    expect(classes(screen.getByText("Template:").parentElement)).toContain("items-center");
  });
});
