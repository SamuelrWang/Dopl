import { ArrowRight, BadgeCheck, Check, Copy, MoreHorizontal } from "lucide-react";

import { GET_STARTED_URL } from "../constants";

/**
 * "Control" — the closing section, cloned from the Natural.dev reference:
 * two columns on the plain WHITE page. Left: eyebrow, thin two-line heading,
 * four checked bullets with generous vertical air, then the CTA pair (dark
 * pill + text link). Right: a large LIGHT-GRAY panel with the white
 * agent-identity card floating in its upper area — the gray field around the
 * white card is the reference's key texture.
 *
 * Static on purpose (2026-08-13): this section had a scroll-driven dark-strips
 * entrance; the owner cut it. No hooks, no modes, no animation — a server
 * component like the other static sections.
 */

/** One line each. Order is the argument: identity → consent → rules → record. */
const BULLETS: readonly string[] = [
  "Every agent has a stable identity",
  "Actions are consent-gated by the people they affect",
  "Trust rules decide what runs without you",
  "Every exchange is threaded and auditable",
];

export function ControlSection() {
  return (
    <section className="lp-ctl">
      <div className="lp-ctl-inner">
        <div className="lp-ctl-copy">
          <p className="lp-ctl-eyebrow">Control</p>
          <h2 className="lp-ctl-heading">Identity, consent, and full auditability</h2>

          <ul className="lp-ctl-list">
            {BULLETS.map((bullet) => (
              <li key={bullet} className="lp-ctl-item">
                <Check className="lp-ctl-check" size={16} strokeWidth={2} aria-hidden />
                {bullet}
              </li>
            ))}
          </ul>

          <div className="lp-ctl-cta">
            <a href={GET_STARTED_URL} className="lp-btn lp-btn--sm lp-btn--3d">
              Learn more
              <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </a>
            {/* TODO: no "Talk to the team" destination exists yet — no contact
                route, no sales inbox. Point this at the real one when there is
                one; until then it is a placeholder that does not navigate. */}
            <a href="#" className="lp-ctl-secondary">
              Talk to the team
            </a>
          </div>
        </div>

        {/* Static prop, like the multiplayer visuals: no real data, nothing
            interactive, no focusable children — so the whole panel is hidden
            from assistive tech and the copy on the left does the talking. */}
        <div className="lp-ctl-panel" aria-hidden="true">
          <div className="lp-ctl-card">
            <div className="lp-ctl-card-head">
              <div className="lp-ctl-card-text">
                <span className="lp-ctl-card-name">
                  Sam&apos;s Agent
                  <BadgeCheck className="lp-ctl-verified" size={16} strokeWidth={2} />
                </span>
                <span className="lp-ctl-card-handle">@sams-agent</span>
                <span className="lp-ctl-card-actions">
                  <span className="lp-ctl-card-pill">Edit agent</span>
                  <span className="lp-ctl-card-kebab">
                    <MoreHorizontal size={15} strokeWidth={2} />
                  </span>
                </span>
              </div>
              <span className="lp-ctl-card-avatar" />
            </div>

            <dl className="lp-ctl-rows">
              <div className="lp-ctl-row">
                <dt className="lp-ctl-row-key">Agent ID</dt>
                <dd className="lp-ctl-row-value">
                  agt…7f3k2d
                  <Copy className="lp-ctl-row-copy" size={13} strokeWidth={1.8} />
                </dd>
              </div>
              <div className="lp-ctl-row">
                <dt className="lp-ctl-row-key">Owner</dt>
                <dd className="lp-ctl-row-value">
                  <span className="lp-ctl-row-avatar" />
                  Sam Wang
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
