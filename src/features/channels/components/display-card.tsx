"use client";

/**
 * **THE DISPLAY CARD — what an agent showed on the glasses (or posted as a display), in chat.**
 * One module for every channel surface: `transcript.tsx` draws it inside `AuthoredRow` for any
 * message carrying `metadata.display` (`lib/message-device.ts`), so the channels page, the desktop
 * workspace pages and the /home record pane all get it from the one transcript.
 *
 * ⚠ **THE AGENT CARD'S SHELL, BY REFERENCE** (`escalation-card-face.ts › AGENT_CARD_*`): the bar
 * in the posting agent's paint, the white panel inset under it. The blocks are
 * `display-blocks.tsx`'s; the plain-text body stays the fallback for surfaces that do not know
 * displays (the glasses inbox, MCP readers, an older desktop).
 *
 * ⚠ **LIVE BY CONSTRUCTION.** An update rewrites the SAME message's `metadata.display`; the
 * transcript's doorbell refetch re-renders this card, which holds no copy of the blocks.
 */

import { cn } from "@/shared/lib/utils";
import type { MessageDisplay } from "../lib/message-device";
import { useDisplayWrites } from "../hooks/use-display-writes";
import { DisplayBlocks } from "./display-blocks";
import {
  AGENT_CARD_BAR,
  AGENT_CARD_BAR_TYPE,
  AGENT_CARD_PANEL,
  AGENT_CARD_SHELL,
} from "./escalation-card-face";

export const DISPLAY_CARD_LABEL = "Display";

export function DisplayCard({
  channelId,
  messageId,
  display,
  paint,
  canAct,
}: {
  channelId: string;
  messageId: string;
  display: MessageDisplay;
  /** `escalation-card-face.ts › decisionCardPaint` of the posting agent. */
  paint: string;
  /** The viewer's own agent showed it (the row is on their side): choices and Save are theirs.
   *  False renders the same card read-only — no dead buttons. */
  canAct: boolean;
}) {
  const writes = useDisplayWrites(channelId, messageId);
  return (
    <div
      data-display-screen={display.screenId || undefined}
      className={AGENT_CARD_SHELL}
      style={{ backgroundColor: paint }}
    >
      <div className={AGENT_CARD_BAR}>
        <span className={cn(AGENT_CARD_BAR_TYPE, "flex-1")}>{DISPLAY_CARD_LABEL}</span>
        {canAct && (
          <button
            type="button"
            disabled={writes.busy || writes.saved}
            onClick={() => void writes.save()}
            className="shrink-0 text-caption font-medium text-text-on-cta/80 transition-colors hover:text-text-on-cta disabled:cursor-default"
          >
            {writes.saved ? "Saved" : "Save"}
          </button>
        )}
      </div>
      <div className={AGENT_CARD_PANEL}>
        <DisplayBlocks
          display={display}
          onChoose={canAct ? (choice) => void writes.answer(choice) : undefined}
          pending={writes.pending}
          busy={writes.busy}
        />
      </div>
    </div>
  );
}
