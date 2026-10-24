import "@/features/marketing/closing.css";

import Link from "next/link";
import { Plus } from "lucide-react";

import { ANCHORS, FAQ_COPY } from "./closing-content";
import { ScrollReveal } from "./scroll-reveal";

/** FAQ: Control's two-column grid, copy left, accordion right.
 *
 *  ⚠ Native `<details>`/`<summary>`, so it stays a server component and is
 *  keyboard + screen-reader accessible with no script. The shared `name`
 *  makes it exclusive (one open at a time) where the browser supports it;
 *  elsewhere each item simply toggles on its own. */
export function FaqSection() {
  return (
    <ScrollReveal className="lp-faq">
      <div className="lp-faq-inner" id={ANCHORS.faq}>
        <div className="lp-faq-copy">
          <p className="lp-faq-eyebrow">{FAQ_COPY.eyebrow}</p>
          <h2 className="lp-faq-heading">{FAQ_COPY.heading}</h2>
        </div>

        <div className="lp-faq-list">
          {FAQ_COPY.items.map((item) => (
            <details key={item.q} name="lp-faq" className="lp-faq-item">
              <summary className="lp-faq-q">
                <span>{item.q}</span>
                <Plus className="lp-faq-icon" size={18} strokeWidth={1.8} aria-hidden />
              </summary>
              <div className="lp-faq-a">
                <p>{item.a}</p>
                {item.link && (
                  <Link href={item.link.href} className="lp-faq-link">
                    {item.link.label}
                  </Link>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </ScrollReveal>
  );
}
