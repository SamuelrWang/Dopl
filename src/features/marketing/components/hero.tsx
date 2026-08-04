import { DOWNLOAD_URL, HERO } from "../constants";
import { ArrowUpRight } from "./icons";
import { ImageDeck } from "./image-deck";

/**
 * Centered headline + subhead + the page's single CTA, over an image deck.
 *
 * This row held a dark "Login" primary beside a light "Download" secondary. It
 * is now one button: the download, in the primary surface the login had, because
 * a hero with only a secondary-styled button reads as having no ask at all.
 * See ../constants.ts for why login left the landing page.
 */
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
        <a href={DOWNLOAD_URL} download className="lp-btn lp-btn--sm lp-btn--3d">
          {HERO.primaryCta}
          <ArrowUpRight size={14} />
        </a>
      </div>

      <ImageDeck />
    </section>
  );
}
