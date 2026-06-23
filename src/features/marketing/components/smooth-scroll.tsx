"use client";

import type { ReactNode } from "react";
import { ReactLenis } from "lenis/react";

/** Momentum smooth-scroll for the landing page. `root` attaches Lenis to the
 *  window scroll so the scroll-linked 3D sections read buttery. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.1, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}
