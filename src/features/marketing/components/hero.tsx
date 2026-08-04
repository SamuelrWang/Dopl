import { GET_STARTED_URL, HERO } from "../constants";
import { ArrowUpRight } from "./icons";
import { ImageDeck } from "./image-deck";

/**
 * Centered headline + subhead + the page's single CTA, over an image deck.
 *
 * This row held a dark "Login" primary beside a light "Download" secondary, then
 * one Download in the primary surface. It is now "Get Started" — the SAME button,
 * same classes, same place, pointed at `/login`, which hands off to
 * `/get-started` and the dmg the moment an account exists. See ../constants.ts.
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
        {/* No `download` attribute: this is a page now, not a file. */}
        <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
          {HERO.primaryCta}
          <ArrowUpRight size={14} />
        </a>
      </div>

      <ImageDeck />
    </section>
  );
}
