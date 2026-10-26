// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MenuItem, Popover } from "./popover-menu";
import { SelectMenu } from "./select-menu";

/**
 * 🔒 THE DROPDOWN WIDTH RULE (Samuel, 2026-10-26): *"the popups are way wider than the
 * maximum text width, so this is just a ton of empty space ... some sort of universal
 * component ... It would be dynamically adjusted."*
 *
 * ⚠ ONE RULE, ON THE SURFACE: `.menu-card` is `width: max-content`, floored at
 * `--menu-min-width` or the `--menu-trigger-width` `Popover` sets, capped at
 * `--menu-max-width`, both bounded by the viewport. `SelectMenu` used to force
 * `min-w-[280px] max-w-[340px]` over it, which is the empty space he saw; this pins
 * that no fixed width comes back through the primitive, and that both kit copies
 * carry the rule (`check-css-token-drift.ts` compares selector NAMES, not bodies).
 */
const ROOT = process.cwd();
const KITS = {
  web: "src/app/globals.css",
  spa: "apps/desktop-ui/src/styles/kit.css",
} as const;
const PALETTE = {
  web: "src/app/globals.css",
  spa: "apps/desktop-ui/src/styles/tokens.css",
} as const;
const read = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The first `.menu-card { … }` body (the base rule, not its `[data-*]` variants). */
function cardBlock(source: string): string {
  const m = source.match(/\n\.menu-card\s*\{([^}]*)\}/);
  if (!m) throw new Error("no `.menu-card` rule");
  return m[1].replace(/\s+/g, " ");
}

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
] as const;

function openSelect(triggerWidth: number) {
  render(<SelectMenu value="a" options={OPTIONS} onChange={() => {}} ariaLabel="Pick" />);
  const trigger = screen.getByRole("button", { name: "Pick" });
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    left: 20,
    right: 20 + triggerWidth,
    top: 10,
    bottom: 30,
    width: triggerWidth,
    height: 20,
    x: 20,
    y: 10,
    toJSON: () => ({}),
  } as DOMRect);
  fireEvent.click(trigger);
  return screen.getByRole("menu");
}

describe("🔒 dropdown width — fit the text, floor at the trigger, cap and clamp", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("SelectMenu's menu carries no fixed width utility", () => {
    const menu = openSelect(96);
    const classes = menu.className.split(/\s+/);
    expect(classes).toContain("menu-card");
    // The old 280/340 pair, and any other forced width, gone from the primitive.
    expect(classes.filter((c) => /^(min-w|max-w|w)-/.test(c))).toEqual([]);
  });

  it("SelectMenu floors the menu at its trigger's width", () => {
    const menu = openSelect(212);
    expect(menu.style.getPropertyValue("--menu-trigger-width")).toBe("212px");
  });

  it("an anchored Popover without a trigger width sets no floor of its own", () => {
    render(
      <Popover open onClose={() => {}}>
        <MenuItem onSelect={() => {}}>Rename</MenuItem>
      </Popover>
    );
    const menu = screen.getByRole("menu");
    expect(menu.className.split(/\s+/).filter((c) => /^(min-w|max-w|w)-/.test(c))).toEqual([]);
    expect(menu.style.getPropertyValue("--menu-trigger-width")).toBe("");
  });

  it("labels truncate by default, and wrap only when the menu opts in", () => {
    const { rerender } = render(
      <Popover open onClose={() => {}}>
        <MenuItem onSelect={() => {}}>A long option label</MenuItem>
      </Popover>
    );
    const label = screen.getByText("A long option label");
    expect(label.className.split(/\s+/)).toContain("menu-row-label");
    expect(label.getAttribute("title")).toBe("A long option label");
    expect(screen.getByRole("menu").hasAttribute("data-wrap")).toBe(false);
    rerender(
      <Popover open wrap onClose={() => {}}>
        <MenuItem onSelect={() => {}}>A long option label</MenuItem>
      </Popover>
    );
    expect(screen.getByRole("menu").getAttribute("data-wrap")).toBe("true");
  });

  it.each(Object.entries(KITS))("%s: `.menu-card` is fit-content, floored and capped", (_s, rel) => {
    const block = cardBlock(read(rel));
    expect(block).toContain("width: max-content;");
    expect(block).toMatch(
      /min-width: min\( max\(var\(--menu-min-width\), var\(--menu-trigger-width, 0px\)\), calc\(100vw - 2 \* var\(--menu-viewport-gutter\)\) \);/
    );
    expect(block).toMatch(
      /max-width: min\(var\(--menu-max-width\), calc\(100vw - 2 \* var\(--menu-viewport-gutter\)\)\);/
    );
  });

  it.each(Object.entries(KITS))("%s: a label truncates, `[data-wrap]` wraps it", (_s, rel) => {
    const css = read(rel).replace(/\s+/g, " ");
    expect(css).toMatch(/\.menu-row-label \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.menu-card\[data-wrap="true"\] \.menu-row-label \{[^}]*white-space: normal;/);
  });

  it.each(Object.entries(PALETTE))("%s: the floor and cap are tokens", (_s, rel) => {
    const src = read(rel);
    expect(src).toMatch(/--menu-min-width:\s*128px;/);
    expect(src).toMatch(/--menu-max-width:\s*320px;/);
    expect(src).toMatch(/--menu-viewport-gutter:\s*8px;/);
  });
});
