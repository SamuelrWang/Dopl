import { Section } from "./bits";
import { HOW } from "./content";

/** 4. How it works: a three-step strip, Connect then Context then Deliver. */
export function HowSection() {
  return (
    <Section id="dv-how" eyebrow={HOW.eyebrow} heading={HOW.heading} line={HOW.line}>
      <ol className="lp-dv-steps">
        {HOW.steps.map((step, i) => (
          <li key={step.title} className="lp-dv-step">
            <span className="lp-dv-step-num" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="lp-mp-card-title">{step.title}</h3>
            <p className="lp-mp-card-body">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
