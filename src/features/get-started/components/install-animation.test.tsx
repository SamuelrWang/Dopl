// @vitest-environment jsdom
/**
 * /get-started's DMG drawing (Samuel, 2026-10-14: "make it look a lot closer to
 * what's actually on Apple"). Pins the four things that ruling bought:
 *
 * 1. the REAL Applications folder art, not a hand-drawn folder;
 * 2. the hollow dashed BLOCK arrow, not a dashed line;
 * 3. the landing demo's pointer, rendered from the one shared component;
 * 4. the dragged copy rides INSIDE the cursor's movers — "you literally just see
 *    the cursor move … it doesn't actually drag the actual icon" was a copy on
 *    its own translate tracks that could (and did) part from the hand.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { InstallAnimation } from "./install-animation";
import { DemoCursorGlyph } from "@/features/marketing/components/demo-cursor";

const CSS = readFileSync(join(process.cwd(), "src/features/get-started/install-animation.css"), "utf8");

afterEach(cleanup);

describe("InstallAnimation", () => {
  it("draws the real Applications folder icon, and the asset exists", () => {
    const { container } = render(<InstallAnimation />);
    const folder = container.querySelector<HTMLImageElement>(".gs-folder-icon");
    expect(folder?.tagName).toBe("IMG");
    expect(folder?.getAttribute("src")).toBe("/img/get-started/applications-folder.webp");
    expect(folder?.getAttribute("alt")).toBe("");
    expect(folder?.getAttribute("draggable")).toBe("false");
    expect(() =>
      readFileSync(join(process.cwd(), "public/img/get-started/applications-folder.webp")),
    ).not.toThrow();
  });

  it("draws a hollow dashed block arrow (one closed outline, no fill)", () => {
    const { container } = render(<InstallAnimation />);
    const paths = container.querySelectorAll(".gs-arrow path");
    expect(paths).toHaveLength(1);
    const d = paths[0]!.getAttribute("d") ?? "";
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(paths[0]!.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(container.querySelector(".gs-arrow")?.getAttribute("fill")).toBe("none");
  });

  it("renders the landing demo's shared pointer", () => {
    const { container } = render(<InstallAnimation />);
    const { container: shared } = render(<DemoCursorGlyph />);
    expect(container.querySelector(".gs-pointer")?.innerHTML).toBe(shared.innerHTML);
  });

  it("carries the dragged copy and the pointer on ONE pair of movers", () => {
    const { container } = render(<InstallAnimation />);
    const mover = container.querySelector(".gs-hand-y > .gs-hand-x");
    expect(mover?.querySelector(":scope > .gs-ghost")).not.toBeNull();
    expect(mover?.querySelector(":scope > .gs-pointer")).not.toBeNull();
    // The copy must not grow its own travel tracks back.
    expect(CSS).not.toMatch(/gs-ghost-[xy]/);
    expect(CSS).not.toMatch(/\.gs-ghost\s*\{[^}]*translate/);
  });

  it("hides the hand and shows the outcome under reduced motion", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.gs-dmg \*\s*\{\s*animation: none !important;/);
    expect(block).toMatch(/\.gs-hand-y\s*\{\s*display: none;/);
    expect(block).toMatch(/\.gs-check\s*\{\s*opacity: 1;/);
  });
});
