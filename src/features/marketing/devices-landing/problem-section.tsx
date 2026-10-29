import { Section } from "./bits";
import { PROBLEM } from "./content";

/** 2. The problem: a before/after bento. Left, every device kind with its own pairing, auth and
 *  delivery code; right, one `@dopl/devices` call. Generic device kinds, no vendor names. */
export function ProblemSection() {
  return (
    <Section id="dv-problem" eyebrow={PROBLEM.eyebrow} heading={PROBLEM.heading} line={PROBLEM.line}>
      <div className="lp-dv-grid lp-dv-grid--2">
        <article className="lp-mp-card lp-dv-tile">
          <div className="lp-dv-well">
            {PROBLEM.beforeRows.map((row) => (
              <div key={row.device} className="lp-dv-row">
                <span className="lp-dv-row-name">{row.device}</span>
                {row.parts.map((part) => (
                  <span key={part} className="lp-dv-chip">
                    {part}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="lp-mp-copy">
            <h3 className="lp-mp-card-title">{PROBLEM.beforeTitle}</h3>
          </div>
        </article>

        <article className="lp-mp-card lp-dv-tile">
          <div className="lp-dv-well">
            <pre className="lp-dv-snippet">
              <span className="lp-dv-key">import</span> {"{ Dopl }"} <span className="lp-dv-key">from</span>{" "}
              {'"@dopl/devices";'}
              {"\n\n"}
              <span className="lp-dv-key">await</span> {'dopl.users.deliver("usr_123", {'}
              {'\n  intent: "message",'}
              {'\n  content: { text: "Your build finished" },'}
              {"\n});"}
            </pre>
            <div className="lp-dv-row">
              <span className="lp-dv-row-name">Any device</span>
              <span className="lp-dv-chip lp-dv-chip--ink">One call</span>
            </div>
          </div>
          <div className="lp-mp-copy">
            <h3 className="lp-mp-card-title">{PROBLEM.afterTitle}</h3>
            <p className="lp-mp-card-body">{PROBLEM.afterNote}</p>
          </div>
        </article>
      </div>
    </Section>
  );
}
