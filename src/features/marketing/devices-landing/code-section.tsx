"use client";

import { useState } from "react";

import { CodeLines, Section, WindowBar } from "./bits";
import { CODE_TABS } from "./code-samples";
import { CODE } from "./content";

/** 5. Code: the landing's code window with a TypeScript and a cURL tab. Same flow in both:
 *  a Connect session, then a delivery (the TypeScript tab also asks). */
export function CodeSection() {
  const [active, setActive] = useState<(typeof CODE_TABS)[number]["id"]>("ts");
  const tab = CODE_TABS.find((t) => t.id === active) ?? CODE_TABS[0];

  return (
    <Section id="dv-code" eyebrow={CODE.eyebrow} heading={CODE.heading} line={CODE.line}>
      <div className="lp-connect-term">
        <WindowBar>
          <div className="lp-dv-tabs" role="tablist" aria-label="Language">
            {CODE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`dv-code-tab-${t.id}`}
                aria-selected={t.id === active}
                aria-controls="dv-code-panel"
                className="lp-dv-tab"
                onClick={() => setActive(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </WindowBar>
        <pre id="dv-code-panel" role="tabpanel" aria-labelledby={`dv-code-tab-${tab.id}`} className="lp-dv-code">
          <CodeLines code={tab.code} />
        </pre>
      </div>
      <p className="lp-dv-note">{CODE.simulatorNote}</p>
    </Section>
  );
}
