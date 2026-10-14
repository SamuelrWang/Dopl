"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { panelPath } from "./panel-shape";
import {
  GLASS_MS, GLASS_NOTCH_RADIUS, GLASS_RADIUS, GLASS_RIM_BITE,
  easeInOutCubic, glassBox, glassShape, poseDepths,
  type AuthGlassPose, type BiteDepths, type GlassBox,
} from "./auth-glass-geometry";

/**
 * THE MORPH: the glass's box AND its outline, interpolated together frame by
 * frame. Split out of `./auth-banner-panel.tsx` (2026-10-13) to keep that file
 * under the 500-line cap (INVARIANTS §1) when the vertical pose made the BOX
 * move too.
 *
 * ⚠ THE BOX IS WRITTEN HERE, NOT BY A CSS TRANSITION. It used to be a CSS
 * `top` transition on a curve matched to `easeInOutCubic`, with the outline
 * drawn in JS — two clocks that only agreed because only `top` moved. The
 * vertical pose changes width and height too, and the outline's mask is in the
 * box's own px, so a box on one clock and a path on another would tear at the
 * edges mid-flight. One loop writes both, so every frame's outline is drawn for
 * exactly the box it sits in.
 *
 * Every mask path is written IMPERATIVELY, never from JSX: React re-rendering
 * `d` would fight the loop. They all carry the SAME outline, so one string per
 * frame feeds the lot.
 */

export interface GlassMorphTargets {
  /** The pane (the clip layer) — measured for the box. */
  pane: RefObject<HTMLDivElement | null>;
  /** The glass group — its left/top/width/height are written each frame. */
  group: RefObject<HTMLDivElement | null>;
  /** The glass + rim band + shadow-layer paths: all take the plain outline. */
  paths: RefObject<(SVGPathElement | null)[]>;
  /** The shadow's knockout: the bitten outline, so the cutout keeps a shadow. */
  knockout: RefObject<SVGPathElement | null>;
  /** The rim's outside knockout — the box rect, then the outline, `evenodd`. */
  rimClip: RefObject<SVGPathElement | null>;
}

const NONE: BiteDepths = { top: 0, bot: 0, left: 0 };
const KEYS = ["top", "bot", "left"] as const;
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/**
 * Drives the glass into `movePose`. Returns the measured pane and the TARGET
 * box (the settled one — what the card and its content are laid out in; the
 * card is never visible mid-flight).
 */
export function useGlassMorph(
  t: GlassMorphTargets,
  movePose: AuthGlassPose,
  still: boolean
): { pane: { w: number; h: number } | null; box: GlassBox | null } {
  const [pane, setPane] = useState<{ w: number; h: number } | null>(null);
  const cur = useRef<{ box: GlassBox | null; d: BiteDepths }>({ box: null, d: NONE });
  const painted = useRef<AuthGlassPose | null>(null);
  const { pane: paneRef, group, paths, knockout, rimClip } = t;

  // Measure the PANE (not the glass): it survives the glass being clipped to
  // nothing mid-morph, and the box is derived from it per pose.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      setPane((prev) =>
        prev && Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height }
      );
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [paneRef]);

  // ⚠ THE TARGET BOX IS A DEPENDENCY, not just the pose and pane. The card
  // mask is drawn from `glassBox` on every render, but the group's box only
  // moves when this effect runs — so a change to the box math alone (the
  // vertical pose's widening, landing by hot reload) left the group at the old
  // 270px while the card was cut for 302, and the card's right inset read 0
  // (Samuel 2026-10-13, "it's not centered"). Keying on the box itself means
  // the group can never disagree with the card it holds.
  const target = pane ? glassBox(movePose, pane.w, pane.h) : null;
  const targetKey = target ? `${target.x}|${target.y}|${target.w}|${target.h}` : "";

  useLayoutEffect(() => {
    if (!pane) return;
    const toBox = glassBox(movePose, pane.w, pane.h);
    const toD = poseDepths(movePose, toBox.w, toBox.h);
    const fromBox = cur.current.box ?? toBox;
    const fromD = { ...cur.current.d };
    // A resize with no pose change SNAPS: only a pose change is a flight.
    const animate = !still && painted.current !== movePose;
    painted.current = movePose;

    // ⚠ WHEN BITES BOTH CLOSE AND OPEN, THEY TAKE TURNS — the closing ones own
    // the first half, the opening ones the second. Running them together is
    // what made the slide read as a double outline: at mid-flight BOTH were
    // half open, so the panel wore two notches at once and the rim traced both
    // (Samuel #3098B, caught on frame captures at 430ms and 650ms). The box
    // itself moves over the whole flight.
    const turns =
      KEYS.some((k) => toD[k] < fromD[k]) && KEYS.some((k) => toD[k] > fromD[k]);
    const phase = (x: number, a: number, b: number) => {
      if (!turns) return easeInOutCubic(x);
      const p = b < a ? x / 0.5 : (x - 0.5) / 0.5; // close first, then open
      return easeInOutCubic(Math.min(1, Math.max(0, p)));
    };

    const paint = (x: number) => {
      const f = easeInOutCubic(x);
      const box = {
        x: lerp(fromBox.x, toBox.x, f),
        y: lerp(fromBox.y, toBox.y, f),
        w: lerp(fromBox.w, toBox.w, f),
        h: lerp(fromBox.h, toBox.h, f),
      };
      const d = {
        top: lerp(fromD.top, toD.top, phase(x, fromD.top, toD.top)),
        bot: lerp(fromD.bot, toD.bot, phase(x, fromD.bot, toD.bot)),
        left: lerp(fromD.left, toD.left, phase(x, fromD.left, toD.left)),
      };
      cur.current = { box, d };
      const g = group.current;
      if (g) {
        g.style.setProperty("left", `${box.x}px`);
        g.style.setProperty("top", `${box.y}px`);
        g.style.setProperty("width", `${box.w}px`);
        g.style.setProperty("height", `${box.h}px`);
      }
      const shape = glassShape(box.w, d);
      const outline = panelPath(box.w, box.h, shape, {
        radius: GLASS_RADIUS,
        notchRadius: GLASS_NOTCH_RADIUS,
      });
      // ⚠ THE RIM STROKES THE FULL OUTLINE, CUTOUT EDGES INCLUDED (Samuel
      // reversed the un-bitten-rect stroke of #3112 the same evening).
      for (const p of paths.current ?? []) p?.setAttribute("d", outline);
      knockout.current?.setAttribute("d", outline);
      // ⚠ THE RIM'S KNOCKOUT IS INSET BY A HAIR (`GLASS_RIM_BITE`), ON PURPOSE:
      // the exact outline left its own antialiased edge over the brightest part
      // of the blurred band, surviving as a 1px white fringe OUTSIDE the bite
      // (#3112; a full-region pixel diff found 245 px at the concave corner).
      rimClip.current?.setAttribute(
        "d",
        `M0,0 H${box.w} V${box.h} H0 Z ${panelPath(box.w, box.h, shape, {
          radius: GLASS_RADIUS,
          notchRadius: GLASS_NOTCH_RADIUS,
          inset: GLASS_RIM_BITE,
        })}`
      );
    };

    if (!animate) {
      paint(1);
      return;
    }
    paint(0);
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / GLASS_MS);
      paint(x);
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [movePose, pane, still, group, paths, knockout, rimClip, targetKey]);

  return { pane, box: target };
}
