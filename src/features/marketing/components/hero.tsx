import Link from "next/link";

import { CTA_LABEL, HERO } from "../constants";
import { HeroDiagram } from "./hero-diagram";

/** Hero — serif headline + lead + CTA on the left, dark agent-flow panel on
 *  the right. */
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
        <HeroDiagram />
      </div>
    </header>
  );
}
