import Link from "next/link";

import { CURVE_TEXT, HERO, RIBBON_TEXT, WAVEFORM_HEIGHTS } from "../constants";

const LOOP_L =
  "M 250 50 C 60 60, 20 250, 120 360 C 200 450, 360 430, 360 320 C 360 240, 250 230, 230 320 C 200 460, 320 600, 520 700";
const RIBBON =
  "M -20 360 C 250 300, 360 250, 620 250 C 880 250, 980 150, 1200 60";

/** Hero — two-tone serif headline over the cream field, with the decorative
 *  curved-text spiral, waveform pill, and black ribbon flowing around it. */
export function Hero() {
  return (
    <header className="hero">
      <svg className="curve-left" viewBox="0 0 560 760">
        <defs>
          <path id="loopL" d={LOOP_L} />
        </defs>
        <text>
          <textPath href="#loopL" startOffset="0">
            {CURVE_TEXT}
          </textPath>
        </text>
      </svg>

      <div className="hero-inner">
        <h1 className="serif">
          <span className="g1">{HERO.headlineGray}</span>
          <br />
          <span className="g2">{HERO.headlineInk}</span>
        </h1>
        <p className="sub">
          {HERO.subLine1}
          <br />
          {HERO.subLine2}
        </p>
        <Link className="btn-hero" href="/login">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m13 6 6 6-6 6" />
          </svg>
          {HERO.cta}
        </Link>
        <p className="avail">{HERO.avail}</p>
        <div>
          <span className="grammar">
            <svg
              className="ck"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {HERO.loadedPill}
          </span>
        </div>
      </div>

      <div className="waveform">
        {WAVEFORM_HEIGHTS.map((h, i) => (
          <i key={i} style={{ height: `${h}px` }} />
        ))}
      </div>

      <svg className="ribbon-right" viewBox="0 0 1180 420" preserveAspectRatio="none">
        <defs>
          <path id="ribbon" d={RIBBON} />
        </defs>
        <path className="band" d={RIBBON} />
        <text>
          <textPath href="#ribbon" startOffset="2%">
            {RIBBON_TEXT}
          </textPath>
        </text>
      </svg>
    </header>
  );
}
