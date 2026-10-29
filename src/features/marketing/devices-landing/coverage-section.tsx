import { Glasses, Laptop, Smartphone, Speaker, Watch, type LucideIcon } from "lucide-react";

import { Section } from "./bits";
import { COVERAGE } from "./content";

const ICONS: Record<(typeof COVERAGE.kinds)[number]["id"], LucideIcon> = {
  glasses: Glasses,
  phone: Smartphone,
  watch: Watch,
  home: Speaker,
  desktop: Laptop,
};

/** 7. Device coverage: one tile per device category. Category glyphs only, no brand logos. */
export function CoverageSection() {
  return (
    <Section id="dv-coverage" eyebrow={COVERAGE.eyebrow} heading={COVERAGE.heading} line={COVERAGE.line}>
      <ul className="lp-dv-grid lp-dv-grid--kinds">
        {COVERAGE.kinds.map((kind) => {
          const Icon = ICONS[kind.id];
          return (
            <li key={kind.id} className="lp-dv-kind">
              <span className="lp-dv-icon" aria-hidden>
                <Icon size={16} strokeWidth={1.8} />
              </span>
              {kind.title}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
