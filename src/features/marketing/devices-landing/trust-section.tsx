import { Check } from "lucide-react";

import { Section } from "./bits";
import { TRUST } from "./content";

/** 9. Trust and security: a short list in the landing's check-list face (`.lp-ctl-list`). */
export function TrustSection() {
  return (
    <Section id="dv-trust" eyebrow={TRUST.eyebrow} heading={TRUST.heading} line={TRUST.line}>
      <ul className="lp-ctl-list lp-dv-trust">
        {TRUST.items.map((item) => (
          <li key={item} className="lp-ctl-item">
            <Check size={16} strokeWidth={2} className="lp-ctl-check" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}
