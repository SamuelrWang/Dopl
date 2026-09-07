// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SelectMenu } from "./select-menu";

/**
 * The settings-row face (Samuel, 2026-09-06): "the dropdowns aren't pills
 * anymore but just the text and an arrow, and an underline." A pill is a
 * border plus a fill; this pins that `text` wears neither and does wear the
 * underline, and that `flat` is still the pill for everyone else.
 */
/** Whole-class-token match: `border` must not hit `decoration-border-strong`. */
const hasClass = (el: Element, token: string) => el.className.split(/\s+/).includes(token);
const hasPrefix = (el: Element, prefix: string) =>
  el.className.split(/\s+/).some((c) => c.startsWith(prefix));

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

describe("SelectMenu › text face", () => {
  afterEach(cleanup);

  it("is the label, underlined, with the chevron — no border, no fill", () => {
    render(
      <SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" variant="text" />
    );
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(hasClass(trigger, "underline")).toBe(true);
    expect(hasClass(trigger, "border")).toBe(false);
    expect(hasPrefix(trigger, "bg-")).toBe(false);
    expect(trigger.querySelector("svg")).not.toBeNull();
  });

  it("flat is still the pill", () => {
    render(<SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" />);
    const trigger = screen.getByRole("button", { name: "Pick" });
    expect(hasClass(trigger, "border")).toBe(true);
    expect(hasClass(trigger, "underline")).toBe(false);
  });
});
