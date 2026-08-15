import { GET_STARTED_URL, HERO } from "../constants";
import { ArrowUpRight } from "./icons";

export function HeroIntro() {
  return (
    <>
      <h1 className="lp-headline">
        {HERO.headlineLines.map((line, i) => (
          <span key={i} className="lp-headline-line">
            {line}
          </span>
        ))}
      </h1>

      <p className="lp-subhead">{HERO.subhead}</p>

      <div className="lp-cta-row">
        {/* No `download` attr — target is a page, not a file. */}
        <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
          {HERO.primaryCta}
          <ArrowUpRight size={14} />
        </a>
      </div>
    </>
  );
}
