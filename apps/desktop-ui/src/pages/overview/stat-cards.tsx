import type { ComponentType } from "react";
import { Bot, Hash, MessageSquare, Users } from "lucide-react";
import type { WorkspaceOverview } from "@/features/workspaces/types";
import { CardLabel, IconTile, StatFigure, padCount } from "./overview-bits";

type Counts = WorkspaceOverview["counts"];

interface CardSpec {
  key: keyof Counts;
  label: string;
  /** ⚠ Must describe what the count MEASURES. "Agents online" counts live
   *  agent sessions, not MCP connections — the note it shipped with. */
  note: string;
  Icon: ComponentType<{ size?: number }>;
}

const CARDS: CardSpec[] = [
  { key: "messagesToday", label: "Messages today", note: "Across all channels", Icon: MessageSquare },
  { key: "agentsRunning", label: "Agents online", note: "Live agent sessions", Icon: Bot },
  { key: "members", label: "Members", note: "On the register", Icon: Users },
  { key: "channels", label: "Channels", note: "Across the workspace", Icon: Hash },
];

/** Today's four head-counts — one equal-width card each. */
export function StatCards({ counts }: { counts: Counts }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {CARDS.map(({ key, label, note, Icon }) => (
        <article key={key} className="bento p-3.5">
          <div className="flex items-center gap-2.5">
            <IconTile>
              <Icon size={14} />
            </IconTile>
            <CardLabel>{label}</CardLabel>
          </div>
          <div className="mt-3.5">
            <StatFigure>{padCount(counts[key])}</StatFigure>
          </div>
          <p className="mt-1.5 text-caption text-text-muted">{note}</p>
        </article>
      ))}
    </div>
  );
}
