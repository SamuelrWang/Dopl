import type { ComponentType } from "react";
import { Bot, Hash, MessageSquare, Users } from "lucide-react";
import { CardLabel, IconTile, KebabButton, StatFigure } from "./overview-bits";
import { STAT_CARDS, type StatCard } from "./overview-data";

const ICONS: Record<StatCard["icon"], ComponentType<{ size?: number }>> = {
  messages: MessageSquare,
  agents: Bot,
  members: Users,
  channels: Hash,
};

/** Today's four head-counts — one equal-width card each. */
export function StatCards() {
  return (
    <div className="grid grid-cols-4 gap-3">
      {STAT_CARDS.map((card) => {
        const Icon = ICONS[card.icon];
        return (
          <article key={card.label} className="bento p-3.5">
            <div className="flex items-center gap-2.5">
              <IconTile>
                <Icon size={14} />
              </IconTile>
              <CardLabel>{card.label}</CardLabel>
              <KebabButton label={`${card.label} options`} />
            </div>
            <div className="mt-3.5">
              <StatFigure>{card.value}</StatFigure>
            </div>
            <p className="mt-1.5 text-caption text-text-muted">{card.note}</p>
          </article>
        );
      })}
    </div>
  );
}
