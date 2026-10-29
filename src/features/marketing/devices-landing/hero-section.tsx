import { ArrowRight, ArrowUpRight } from "lucide-react";

import { CodeLines, WindowBar } from "./bits";
import { HERO_SNIPPET } from "./code-samples";
import { CTA, DOCS_HREF, GET_KEY_HREF, HERO } from "./content";
import { InstallLine } from "./install-line";

/** 1. Hero: headline, line, both CTAs, then the install line and a tiny delivery call. The type and
 *  load-in are the main landing's (`.lp-hero`, `.lp-headline`, `.lp-subhead`, `.lp-cta-row`). */
export function HeroSection() {
  // "One SDK." on its own line, the rest of the sentence on the next; the text stays verbatim.
  const [first, ...rest] = HERO.heading.split(". ");
  return (
    <section className="lp-hero lp-dv-hero" aria-labelledby="dv-hero-heading">
      <p className="lp-mp-eyebrow">{HERO.eyebrow}</p>
      <h1 id="dv-hero-heading" className="lp-headline">
        <span className="lp-headline-line">{first}.</span> <span className="lp-headline-line">{rest.join(". ")}</span>
      </h1>
      <p className="lp-subhead">{HERO.line}</p>
      <div className="lp-cta-row">
        <a href={GET_KEY_HREF} className="lp-btn lp-btn--sm lp-btn--3d">
          {CTA.key}
          <ArrowRight size={14} strokeWidth={2} aria-hidden />
        </a>
        <a href={DOCS_HREF} className="lp-btn lp-btn--sm lp-btn--3d-light">
          {CTA.docs}
          <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
        </a>
      </div>

      <div className="lp-connect-term lp-dv-hero-window">
        <WindowBar>
          <span className="lp-connect-file">deliver.ts</span>
        </WindowBar>
        <InstallLine />
        <pre className="lp-dv-code">
          <CodeLines code={HERO_SNIPPET} />
        </pre>
      </div>
    </section>
  );
}
