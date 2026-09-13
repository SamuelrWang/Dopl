// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SelectMenu } from "./select-menu";

/**
 * The settings-row face (Samuel, 2026-09-06): "the dropdowns aren't pills
 * anymore but just the text and an arrow." A pill is a border plus a fill; this
 * pins that `text` wears neither, and that `flat` is still the pill for everyone
 * else.
 *
 * ⚠ THE UNDERLINE AND THE BOLD ARE PINNED ABSENT NOW, AND THE OLD CASE ASSERTED
 * THE UNDERLINE PRESENT (Samuel, 2026-09-10, over the Agent Settings block:
 * "unbold these things … also remove the underline"). That is a SUPERSESSION, not
 * a loosened test: the row NAME (`settings-agent-rows.tsx › SettingRow`) and the
 * Working Folder path went on the same clock, and `settings-tab.test.tsx` pins
 * those two. The chevron assertion is what carries the weight now — with no
 * underline it is the ONLY hint that the label opens a menu.
 */
/** Whole-class-token match — kept even though `decoration-*` is gone: `border`
 *  must never hit a `*-border-*` token in some later face. */
const hasClass = (el: Element, token: string) => el.className.split(/\s+/).includes(token);
const hasPrefix = (el: Element, prefix: string) =>
  el.className.split(/\s+/).some((c) => c.startsWith(prefix));

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

describe("SelectMenu › text face", () => {
  afterEach(cleanup);

  it("is the label and the chevron — no border, no fill, no underline, no bold", () => {
    render(
      <SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" variant="text" />
    );
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(hasClass(trigger, "border")).toBe(false);
    expect(hasPrefix(trigger, "bg-")).toBe(false);
    // Samuel, 2026-09-10 — both halves of the same ruling.
    expect(hasPrefix(trigger, "underline")).toBe(false);
    expect(hasPrefix(trigger, "decoration-")).toBe(false);
    expect(hasClass(trigger, "font-medium")).toBe(false);
    expect(hasClass(trigger, "font-semibold")).toBe(false);
    // The chevron is the ONLY remaining affordance, so it is load-bearing.
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  /**
   * 🔒 SAMUEL, 2026-09-13: *"when I hover over the dropdowns in the agent settings, it
   * should have a gray highlight. Anything that can be clicked."*
   *
   * ⚠ THE TOKEN IS THE ASSERTION, not a gray. `--menu-item-hover-bg` is THE one hover
   * face for anything clickable (his 2026-09-10 ruling, DESIGN-SYSTEM's `.menu-row`
   * row) and is `var(--surface-raised-1)` BY REFERENCE — so a second spelling here
   * would pass a screenshot review and then drift the first time the ramp moves.
   * ⚠ AND THE NEGATIVE MARGIN IS HALF THE RULING: these triggers sit in a
   * right-aligned settings cell, so padding alone would shift every value 6px. The
   * pair is what makes the highlight wrap the label WITHOUT moving it.
   * ⚠ NOTE THE RESTING-FILL CASE ABOVE STILL HOLDS: `hover:bg-…` is not a `bg-`
   * class, so "no pill" and "a gray hover" are not in tension.
   */
  it("highlights with the ONE menu hover gray, and does not move when it does", () => {
    render(
      <SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" variant="text" />
    );
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(hasClass(trigger, "hover:bg-menu-item-hover-bg")).toBe(true);
    expect(hasClass(trigger, "px-1.5")).toBe(true);
    expect(hasClass(trigger, "-mx-1.5")).toBe(true);
    // A highlight on an inert control is the affordance lying about the click.
    expect(hasClass(trigger, "disabled:hover:bg-transparent")).toBe(true);
  });

  it("flat is still the pill, and the pill faces keep their own weight", () => {
    render(<SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" />);
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(hasClass(trigger, "border")).toBe(true);
    expect(hasClass(trigger, "underline")).toBe(false);
    // ⚠ `font-medium` MOVED OFF THE SHARED BASE onto each pill face (2026-09-10) so
    // `text` could be regular; this pins the move did not silently unbold the pills.
    expect(hasClass(trigger, "font-medium")).toBe(true);
  });
});
