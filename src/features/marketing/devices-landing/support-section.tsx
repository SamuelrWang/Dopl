import { BookOpen, CircleDot, Mail, MessagesSquare, type LucideIcon } from "lucide-react";

import { Section, Tile } from "./bits";
import { SUPPORT } from "./content";

const ICONS: readonly LucideIcon[] = [BookOpen, CircleDot, Mail, MessagesSquare];

/** 11. Support: where to get help. Only Docs links: the other channels have no public address yet,
 *  so their tiles carry no href rather than a made-up one. */
export function SupportSection() {
  return (
    <Section id="dv-support" eyebrow={SUPPORT.eyebrow} heading={SUPPORT.heading}>
      <div className="lp-dv-grid lp-dv-grid--auto">
        {SUPPORT.items.map((item, i) => {
          const Icon = ICONS[i] ?? BookOpen;
          const tile = (
            <Tile
              title={item.title}
              body={item.body}
              icon={
                <span className="lp-dv-icon" aria-hidden>
                  <Icon size={16} strokeWidth={1.8} />
                </span>
              }
            />
          );
          return "href" in item ? (
            <a key={item.title} href={item.href} className="lp-dv-link">
              {tile}
            </a>
          ) : (
            <div key={item.title}>{tile}</div>
          );
        })}
      </div>
    </Section>
  );
}
