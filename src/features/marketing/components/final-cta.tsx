import "@/features/marketing/closing.css";

import { ArrowUpRight, Download } from "lucide-react";

import { GET_STARTED_URL } from "../constants";
import { FINAL_CTA_COPY as C } from "./closing-content";
import { MultiplierTick } from "./multiplier-tick";
import { ScrollReveal } from "./scroll-reveal";

/** Closing call to action: one sentence in two lines, "You ×10. Start
 *  building digital" / "doppelgängers with Dopl today." (the multiplier ticks
 *  up once in view), then the page's CTA. Server component; the reveal rides
 *  ScrollReveal's `data-reveal`, the tick MultiplierTick's `data-play`.
 *  Screen readers get the final sentence only. */
export function FinalCta() {
  return (
    <ScrollReveal className="lp-final">
      <div className="lp-final-panel">
        <h2 className="lp-final-heading">
          <span className="sr-only">{C.heading}</span>
          <span aria-hidden="true">
            {C.lead} <MultiplierTick values={C.multipliers} suffix="." /> {C.lineStart}
            <br className="lp-final-br" /> {C.lineEnd}
          </span>
        </h2>
        <div className="lp-final-ctas">
          <a href={GET_STARTED_URL} className="lp-btn lp-btn--3d lp-final-btn">
            {C.primary}
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
          </a>
          {/* ⚠ Plain anchor, not next/link: /download is a route handler
              redirecting to the dmg, not a page (same as site-nav.tsx). */}
          <a href={C.secondaryHref} className="lp-btn lp-btn--3d-light lp-final-btn">
            <Download size={14} strokeWidth={2} aria-hidden />
            {C.secondary}
          </a>
        </div>
      </div>
    </ScrollReveal>
  );
}
