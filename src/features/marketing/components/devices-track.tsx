"use client";

import { useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** The Devices band's horizontal scroller. Native scroll-snap does the work
 *  (trackpad / touch / keyboard); prev/next only exist for a mouse wheel that
 *  cannot scroll sideways, and move exactly one page. Panels are `children`, so
 *  they stay server-rendered. */
export function DevicesTrack({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const page = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth, behavior: still ? "auto" : "smooth" });
  };

  return (
    <>
      <div ref={ref} className="lp-dev-track" tabIndex={0}>
        {children}
      </div>
      <div className="lp-dev-nav">
        <button type="button" className="lp-dev-arrow" aria-label="Previous" onClick={() => page(-1)}>
          <ChevronLeft size={18} strokeWidth={2} aria-hidden />
        </button>
        <button type="button" className="lp-dev-arrow" aria-label="Next" onClick={() => page(1)}>
          <ChevronRight size={18} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </>
  );
}
