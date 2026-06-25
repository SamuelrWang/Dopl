import { DOWNLOAD_URL, HERO } from "../constants";
import { ArrowUpRight } from "./icons";
import { ImageDeck } from "./image-deck";

/** Centered headline + subhead + dual CTA, over an empty image placeholder. */
export function Hero() {
  return (
    <section className="lp-hero">
      <h1 className="lp-headline">
        {HERO.headlineLines.map((line, i) => (
          <span key={i} className="lp-headline-line">
            {line}
          </span>
        ))}
      </h1>

      <p className="lp-subhead">{HERO.subhead}</p>

      <div className="lp-cta-row">
        <a href="/login" className="lp-btn lp-btn--sm lp-btn--3d">
          {HERO.primaryCta}
          <ArrowUpRight size={14} />
        </a>
        <a href={DOWNLOAD_URL} download className="lp-btn lp-btn--sm lp-btn--3d-light">
          {HERO.secondaryCta}
          <ArrowUpRight size={14} />
        </a>
      </div>

      <ImageDeck />
    </section>
  );
}
