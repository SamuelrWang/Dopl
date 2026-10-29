import { Activity, Bot, Globe, KeyRound, ShieldAlert, Terminal, Webhook, type LucideIcon } from "lucide-react";

import { Section, Tile } from "./bits";
import { PRODUCTION } from "./content";

/** One icon per tile, in content.ts order. */
const ICONS: readonly LucideIcon[] = [KeyRound, ShieldAlert, Webhook, Activity, Globe, Bot, Terminal];

/** 6. Built for production: the feature bento. */
export function ProductionSection() {
  return (
    <Section id="dv-production" eyebrow={PRODUCTION.eyebrow} heading={PRODUCTION.heading} line={PRODUCTION.line}>
      <div className="lp-dv-grid lp-dv-grid--auto">
        {PRODUCTION.tiles.map((tile, i) => {
          const Icon = ICONS[i] ?? KeyRound;
          return (
            <Tile
              key={tile.title}
              title={tile.title}
              body={tile.body}
              icon={
                <span className="lp-dv-icon" aria-hidden>
                  <Icon size={16} strokeWidth={1.8} />
                </span>
              }
            />
          );
        })}
      </div>
    </Section>
  );
}
