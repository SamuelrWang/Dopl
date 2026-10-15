// @vitest-environment jsdom
/**
 * /get-started's DMG drawing (Samuel, 2026-10-14: "make it look a lot closer to
 * what's actually on Apple"). Pins the four things that ruling bought:
 *
 * 1. the REAL Applications folder art, not a hand-drawn folder;
 * 2. the hollow dashed BLOCK arrow, not a dashed line;
 * 3. the landing demo's pointer, rendered from the one shared component;
 * 4. the drag carries THE ICON ITSELF on the cursor's movers — first a copy on
 *    its own tracks parted from the hand, then a translucent copy on the hand
 *    while the original stayed put read as "the logo doesn't move" (Samuel
 *    2026-10-14). One Dopl icon, no copy, nothing static left in the well;
 * 5. the icon reads as 3D: contact shadow, two-layer depth, a masked glint.
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

  it("carries THE ICON ITSELF and the pointer on ONE pair of drag movers", () => {
    const { container } = render(<InstallAnimation />);
    const mover = container.querySelector(".gs-drag-y > .gs-drag-x");
    const carry = mover?.querySelector(":scope > .gs-carry");
    expect(carry?.querySelector(":scope > img.gs-app-icon")).not.toBeNull();
    // The pointer rides the same drag mover, under its own approach movers.
    expect(mover?.querySelector(":scope > .gs-hand-y > .gs-hand-x > .gs-pointer")).not.toBeNull();
    // Icon before the pointer → the pointer paints over the icon; the drag after
    // both wells → the icon paints over the arrow and the folder while carried.
    const kids = Array.from(mover!.children);
    expect(kids.indexOf(carry!)).toBeLessThan(kids.findIndex((k) => k.classList.contains("gs-hand-y")));
    const stage = Array.from(container.querySelector(".gs-stage")!.children);
    const drag = stage.findIndex((k) => k.classList.contains("gs-drag-y"));
    expect(drag).toBe(stage.length - 1);
  });

  it("draws exactly ONE Dopl icon — no copy, and nothing static left in the well", () => {
    const { container } = render(<InstallAnimation />);
    const icons = container.querySelectorAll('img[src="/favicons/android-chrome-512x512.png"]');
    expect(icons).toHaveLength(1);
    expect(container.querySelector(".gs-ghost")).toBeNull();
    const well = container.querySelector(".gs-well--app");
    expect(well?.querySelector("img")).toBeNull();
    // The home holds only the silhouette slot — an empty shape, no art.
    const home = well?.querySelector(".gs-app-home");
    expect(Array.from(home?.children ?? []).map((k) => k.className)).toEqual(["gs-app-slot"]);
    expect(home?.querySelector(".gs-app-slot")?.childElementCount).toBe(0);
    expect(well?.querySelector(".gs-well-label")?.textContent).toBe("Dopl");
  });

  it("moves the icon ONLY through the shared drag movers, opaque while carried", () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    // No translate on the icon's own nodes: its position IS the movers'.
    for (const sel of ["gs-carry", "gs-app-icon"]) {
      expect(rules).not.toMatch(new RegExp(`\\.${sel}\\s*\\{[^}]*translate`));
    }
    const life = /@keyframes gs-carry-life\s*\{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? "";
    expect(life).not.toMatch(/translate/);
    // Held (35.5–57.5%): full opacity, lifted.
    expect(life).toMatch(/35\.5%,\s*57\.5%\s*\{\s*opacity: 1;\s*transform: scale\(1\.06\)/);
    // The approach tracks are zero for the whole carry (30–62%), so pointer and
    // icon share a transform by construction.
    for (const axis of ["x", "y"]) {
      const kf = new RegExp(`@keyframes gs-hand-${axis}\\s*\\{[\\s\\S]*?30%,\\s*62%\\s*\\{\\s*transform: translate${axis.toUpperCase()}\\(0\\)`);
      expect(rules).toMatch(kf);
    }
  });

  it("gives the icon depth: contact shadow under it and a glint masked to its shape", () => {
    const { container } = render(<InstallAnimation />);
    const carry = container.querySelector(".gs-carry")!;
    const kids = Array.from(carry.children).map((k) => k.className);
    // Contact shadow BEHIND the artwork, glint ON it.
    expect(kids).toEqual(["gs-contact", "gs-app-icon", "gs-glint"]);
    const pad = container.querySelector<HTMLElement>(".gs-glass-pad");
    expect(pad?.style.getPropertyValue("--gs-app-mask")).toBe("url(/favicons/android-chrome-512x512.png)");
    const glint = /\.gs-glint\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(glint).toMatch(/(^|\s)mask: var\(--gs-app-mask\)/);
    expect(CSS).toMatch(/\.gs-glint::before\s*\{[^}]*animation: gs-glint-sweep/);
    expect(CSS).toMatch(/--gs-app-depth-lifted:/);
  });

  it("leaves a light-gray dotted silhouette in the icon's home while it is away", () => {
    const { container } = render(<InstallAnimation />);
    const slot = container.querySelector(".gs-well--app > .gs-app-home > .gs-app-slot");
    expect(slot).not.toBeNull();
    // Under the carried icon: the wells paint before the drag movers.
    const stage = Array.from(container.querySelector(".gs-stage")!.children);
    const well = stage.findIndex((k) => k.classList.contains("gs-well--app"));
    expect(well).toBeLessThan(stage.findIndex((k) => k.classList.contains("gs-drag-y")));
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.gs-app-slot\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";
    expect(rule).toMatch(/border: 1\.5px dotted /);
    expect(rule).toMatch(/background: rgba\(0, 0, 0, 0\.06\)/);
    expect(rule).toMatch(/border-radius: 22\.5%/);
    expect(rule).toMatch(/opacity: 0;/);
    expect(rule).toMatch(/animation: gs-slot-life var\(--gs-t\)/);
    // Hidden at rest, in as the icon lifts (32–35.5%), out as it returns (77–83%).
    const life = /@keyframes gs-slot-life\s*\{([\s\S]*?)\n\}/.exec(rules)?.[1] ?? "";
    expect(life).toMatch(/0%,\s*32%\s*\{\s*opacity: 0;/);
    expect(life).toMatch(/35\.5%,\s*77%\s*\{\s*opacity: 1;/);
    expect(life).toMatch(/83%,\s*100%\s*\{\s*opacity: 0;/);
    // The icon's own lift and return use the same beats.
    expect(rules).toMatch(/@keyframes gs-carry-life[\s\S]*?35\.5%,\s*57\.5%[\s\S]*?77\.01%[\s\S]*?83%,\s*100%/);
    // Reduced motion: the icon rests on top, no silhouette.
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.gs-app-slot\s*\{\s*display: none;/);
  });

  it("hides the hand and shows the outcome under reduced motion", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toMatch(/\.gs-dmg \*\s*\{\s*animation: none !important;/);
    expect(block).toMatch(/\.gs-hand-y\s*\{\s*display: none;/);
    expect(block).toMatch(/\.gs-check\s*\{\s*opacity: 1;/);
    // The icon stays (its movers rest at zero) and the glint rests OFF the icon.
    expect(block).not.toMatch(/\.gs-(drag|carry|app-icon)/);
    expect(CSS).toMatch(/\.gs-glint::before\s*\{[^}]*transform: translateX\(-120%\)/);
  });
});
