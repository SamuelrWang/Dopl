import { ArrowRight, Check } from "lucide-react";

import { GET_STARTED_URL } from "../constants";
import { CONTROL_COPY } from "./control-content";
import { ActivityLog } from "./control-log";
import { ScrollReveal } from "./scroll-reveal";

/** ⚠ Keep this a server component. `<ScrollReveal>` (the `<section>`) and
 *  `<ActivityLog>` (the log, ./control-log.tsx) are the only client
 *  boundaries; the claim column arrives server-rendered as `children`.
 *
 *  ⚠ `lp-ctl--flip` puts the panel LEFT and the claim RIGHT on desktop; it is
 *  Monitoring's alone. connect-section.tsx wears the same `.lp-ctl-*` layout
 *  classes without it and stays claim-left. The DOM keeps the claim first, so
 *  reading order and phones (stacked, claim on top) are unchanged.
 *  Copy: ./control-content.ts. */
export function ControlSection() {
  return (
    <ScrollReveal className="lp-ctl lp-ctl--flip">
      <div className="lp-ctl-inner">
        <div className="lp-ctl-copy">
          <p className="lp-ctl-eyebrow">{CONTROL_COPY.eyebrow}</p>
          <h2 className="lp-ctl-heading">{CONTROL_COPY.heading}</h2>

          <ul className="lp-ctl-list">
            {CONTROL_COPY.bullets.map((bullet) => (
              <li key={bullet} className="lp-ctl-item">
                <Check className="lp-ctl-check" size={16} strokeWidth={2} aria-hidden />
                {bullet}
              </li>
            ))}
          </ul>

          <div className="lp-ctl-cta">
            <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
              {CONTROL_COPY.primaryCta}
              <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </a>
            {/* TODO: no contact route yet — placeholder. No `href` on purpose:
                this file is a server component (no handlers), and `href="#"`
                would rewrite the URL to `/#` and jump-scroll mid-scrub. An
                hrefless <a> keeps the styling and navigates nowhere. */}
            <a className="lp-ctl-secondary">{CONTROL_COPY.secondaryCta}</a>
          </div>
        </div>

        {/* A scripted demo, no focusable children — hidden from AT; the claim
            column is the accessible content. */}
        <div className="lp-ctl-panel" aria-hidden="true">
          <ActivityLog />
        </div>
      </div>
    </ScrollReveal>
  );
}
