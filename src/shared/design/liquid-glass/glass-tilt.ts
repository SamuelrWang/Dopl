"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Hover tilt for a glass panel (Samuel 2026-10-13): the glass pivots about its
 * CENTRE and the side under the cursor dips away from the viewer, with a
 * specular sheen that follows the cursor. Shared by the onboarding glass
 * (`layout/auth-split/glass-tilt.tsx`) and the landing page's panels
 * (`LiquidGlass` › `tilt`).
 *
 * Everything is written IMPERATIVELY on rAF, never through React state: the
 * pointer moves every frame and a re-render per frame would also re-run the
 * panel's mask effects.
 *
 * ⚠ THE TILT IS A CUSTOM PROPERTY (`--glass-tilt`) ON THE GROUP, READ BY EACH
 * GLASS LAYER — never a transform on the group. A transform on ANY ancestor of
 * the refraction layer, 3D or a plain 2D rotate, makes Chromium/Electron drop
 * that layer's `mask`, so the blur covered the whole rect and the cutout went
 * soft mid-tilt (Samuel 2026-10-13; striped-backdrop A/B: wrapper transform →
 * cutout blurred, same transform on the layer → cutout sharp, blur intact).
 * See `LiquidGlass` › LAYER_TILT. At rest the property is REMOVED, so a flat
 * glass carries no transform at all.
 *
 * ⚠ THE SHADOW TILTS WITH THE GLASS, IT NEVER SLIDES. It used to translate
 * toward the raised side, and because the onboarding shadow's mask knocks out
 * the glass's outline the knockout slid too: an offset second outline that
 * read as two stacked panes (Samuel 2026-10-13). The raised-side cast is the
 * caller's `castShadow`, which moves only what can move without a second pane.
 *
 * The pointer is read on the PANE, against the group's untransformed layout
 * box, so the tilting shape never moves its own hit area — reading it off the
 * tilted element jitters at the edges. Pane and group may be ONE element (the
 * landing panels: the hit area is the panel itself).
 */

/** Max tilt, degrees, at the glass's edge. */
const MAX_DEG = 6;
/** Px of perspective the group is drawn through. */
const PERSPECTIVE = 1400;
/** Lerp rate per 16ms frame; scaled by real frame time. */
const RATE = 0.14;

export interface GlassTiltRefs {
  /** Listens for the pointer. */
  pane: RefObject<HTMLElement | null>;
  /** Carries `--glass-tilt`; its layout box is the hit area. */
  group: RefObject<HTMLElement | null>;
  shadow?: RefObject<HTMLElement | null>;
  sheen?: RefObject<HTMLElement | null>;
}

/**
 * Lengthens the shadow on the RAISED side. `(rx, ry)` points from the centre
 * toward the raised side, −1…1; `mag` is the tilt's size, 0…1. Called with
 * zeros when flat, so it must restore the resting shadow then.
 */
export type CastShadow = (shadow: HTMLElement, rx: number, ry: number, mag: number) => void;

/** `(hover: hover) and (pointer: fine)`, and not reduced motion. */
function useTiltCapable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setOk(fine.matches && !calm.matches);
    sync();
    fine.addEventListener("change", sync);
    calm.addEventListener("change", sync);
    return () => {
      fine.removeEventListener("change", sync);
      calm.removeEventListener("change", sync);
    };
  }, []);
  return ok;
}

/**
 * @param enabled the panel is idle (onboarding: no pose hand-off in flight).
 *   Turning it off eases the glass back flat rather than snapping.
 */
export function useGlassTilt(refs: GlassTiltRefs, enabled: boolean, castShadow?: CastShadow): void {
  const capable = useTiltCapable();
  const on = enabled && capable;
  // Held across effect runs, so turning `on` off eases from where it was.
  const state = useRef({ target: { x: 0, y: 0 }, cur: { x: 0, y: 0 } });
  const cast = useRef(castShadow);
  useEffect(() => {
    cast.current = castShadow;
  }, [castShadow]);
  const { pane: paneRef, group: groupRef, shadow: shadowRef, sheen: sheenRef } = refs;

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const { target, cur } = state.current;
    let raf = 0;
    let last = 0;

    const write = () => {
      const group = groupRef.current;
      const shadow = shadowRef?.current;
      const sheen = sheenRef?.current;
      const mag = Math.min(1, Math.hypot(cur.x, cur.y));
      const flat = mag < 0.002;
      // rotateY(+) sends the RIGHT edge away; rotateX(+) brings the BOTTOM
      // forward — so the cursor's side dips on both axes.
      const tilt = flat
        ? ""
        : `perspective(${PERSPECTIVE}px) rotateX(${(-cur.y * MAX_DEG).toFixed(3)}deg) rotateY(${(cur.x * MAX_DEG).toFixed(3)}deg)`;
      // A group marked `data-share-tilt` also hands the tilt to its PARENT as
      // `--glass-tilt-shared`, for siblings drawn over the glass that must
      // tilt with it (the landing hero's demo window). Same value, same centre.
      const share = group?.dataset.shareTilt !== undefined ? group?.parentElement : null;
      if (share) {
        if (tilt) share.style.setProperty("--glass-tilt-shared", tilt);
        else share.style.removeProperty("--glass-tilt-shared");
      }
      if (group) {
        if (tilt) {
          group.style.setProperty("--glass-tilt", tilt);
          // The raised edge projects past the glass's box — see LiquidGlass.
          group.style.setProperty("--glass-overflow", "visible");
        } else {
          group.style.removeProperty("--glass-tilt");
          group.style.removeProperty("--glass-overflow");
        }
      }
      if (shadow) {
        // A shadow outside the glass's layers takes the tilt directly; one
        // inside them reads the same value through `--glass-tilt`.
        shadow.style.transform = tilt;
        cast.current?.(shadow, flat ? 0 : -cur.x, flat ? 0 : -cur.y, flat ? 0 : mag);
      }
      if (sheen) {
        const gx = 50 + cur.x * 50;
        const gy = 50 + cur.y * 50;
        sheen.style.opacity = flat ? "0" : mag.toFixed(3);
        sheen.style.background =
          `radial-gradient(circle at ${gx.toFixed(1)}% ${gy.toFixed(1)}%, ` +
          "rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.07) 32%, rgba(255,255,255,0) 62%)";
      }
    };

    const step = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const k = 1 - Math.pow(1 - RATE, dt / 16);
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      const settled = Math.abs(target.x - cur.x) < 0.001 && Math.abs(target.y - cur.y) < 0.001;
      if (settled) {
        cur.x = target.x;
        cur.y = target.y;
      }
      write();
      raf = settled ? 0 : requestAnimationFrame(step);
    };
    const kick = () => {
      if (raf) return;
      last = 0;
      raf = requestAnimationFrame(step);
    };

    const move = (e: PointerEvent) => {
      const group = groupRef.current;
      if (!group || e.pointerType !== "mouse") return;
      // The group's layout box — untouched by the tilt, which lives on its
      // layers. Read straight off the group when it IS the pane.
      let lx: number;
      let ly: number;
      let w: number;
      let h: number;
      if (group === pane) {
        const r = group.getBoundingClientRect();
        lx = e.clientX - r.left;
        ly = e.clientY - r.top;
        w = r.width;
        h = r.height;
      } else {
        const r = pane.getBoundingClientRect();
        lx = e.clientX - r.left - group.offsetLeft;
        ly = e.clientY - r.top - group.offsetTop;
        w = group.offsetWidth;
        h = group.offsetHeight;
      }
      const inside = lx >= 0 && ly >= 0 && lx <= w && ly <= h && w > 0 && h > 0;
      target.x = inside ? (lx / w) * 2 - 1 : 0;
      target.y = inside ? (ly / h) * 2 - 1 : 0;
      kick();
    };
    const leave = () => {
      target.x = 0;
      target.y = 0;
      kick();
    };

    if (on) {
      pane.addEventListener("pointermove", move);
      pane.addEventListener("pointerleave", leave);
    } else {
      leave();
    }
    return () => {
      pane.removeEventListener("pointermove", move);
      pane.removeEventListener("pointerleave", leave);
      // The next run picks the motion up from `state` (`on` off → `leave()`
      // eases it flat); on unmount the elements go with it.
      cancelAnimationFrame(raf);
    };
  }, [on, paneRef, groupRef, shadowRef, sheenRef]);
}
