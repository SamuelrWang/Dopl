import { ArrowRight, ArrowUpRight } from "lucide-react";

import { CTA, DOCS_HREF, GET_KEY_HREF, GET_STARTED } from "./content";
import { InstallLine } from "./install-line";

/** 12. Get started: the main landing's closing panel (`.lp-final*`, closing.css) with the install
 *  line and the page's two CTAs. */
export function GetStartedSection() {
  return (
    <section className="lp-dv-section lp-dv-bottom lp-dv-final" aria-labelledby="dv-final-heading">
      <div className="lp-final-panel">
        <h2 id="dv-final-heading" className="lp-final-heading">
          {GET_STARTED.heading}
        </h2>
        <p className="lp-dv-final-line">{GET_STARTED.line}</p>
        <div className="lp-connect-term lp-dv-final-install">
          <InstallLine />
        </div>
        <div className="lp-final-ctas">
          <a href={GET_KEY_HREF} className="lp-btn lp-btn--3d lp-final-btn">
            {CTA.key}
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </a>
          <a href={DOCS_HREF} className="lp-btn lp-btn--3d-light lp-final-btn">
            {CTA.docs}
            <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
