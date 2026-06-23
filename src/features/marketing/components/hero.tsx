import Link from "next/link";

import { CTA_LABEL, HERO } from "../constants";
import { HeroVisual } from "./hero-visual";

/** Hero — headline + lead + CTA on the left, recessed crystal panel with a
 *  raised liquid-glass card on the right. */
export function Hero() {
  return (
    <header className="dopl-hero dopl-bound">
      <div className="dopl-hero-copy">
        <h1 className="dopl-headline">{HERO.headline}</h1>
        <p className="dopl-lead">{HERO.paragraph}</p>
        <Link href="/login" className="dopl-cta dopl-cta--hero dopl-hero-cta">
          {CTA_LABEL}
        </Link>
      </div>

      <div className="dopl-hero-visual">
        <HeroVisual />
      </div>
    </header>
  );
}
