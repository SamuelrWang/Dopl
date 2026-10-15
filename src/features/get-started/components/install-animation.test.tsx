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

  it("titles the window \"Dopl Installer\" (Samuel 2026-10-14)", () => {
    const { container } = render(<InstallAnimation />);
    expect(container.querySelector(".gs-dmg-title")?.textContent).toBe("Dopl Installer");
  });

  it("draws the arrow TALL (~1.2:1, not the old flat 70×34), centred on the icons' line", () => {
    const { container } = render(<InstallAnimation />);
    expect(container.querySelector(".gs-arrow")?.getAttribute("viewBox")).toBe("0 0 64 52");
    const rule = /\.gs-arrow\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    const px = (prop: string) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(rule)?.[1]);
    expect(px("width")).toBe(64);
    expect(px("height")).toBe(52);
    // Centre on y 59 — the app tile's and the folder's shared centre line.
    expect(px("top") + px("height") / 2).toBe(59);
    expect(container.querySelector(".gs-arrow path")?.getAttribute("stroke-width")).toBe("1.5");
  });

  it("never applies the glass tilt itself (it rides the glass's content layer)", () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rules).not.toMatch(/--glass-tilt/);
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
