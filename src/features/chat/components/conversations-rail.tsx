"use client";

import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface RailConversation {
  /** Stable conversation identifier (= conversations.panel_id). */
  panelId: string;
  title: string;
  preview: string;
  /** Pre-formatted relative time ("2m", "1h", "3d"). */
  timestamp: string;
}

interface ConversationsRailProps {
  conversations: RailConversation[];
  activePanelId: string;
  isLoading: boolean;
  onSelect: (panelId: string) => void;
  onNew: () => void;
}

/**
 * Left rail of the dedicated /[workspaceSlug]/chat page. Lists the
 * caller's PRIVATE conversations and exposes "+ New" for spawning a
 * fresh one. Hydrated from /api/conversations?visibility=private by
 * the parent ChatShell.
 */
export function ConversationsRail({
  conversations,
  activePanelId,
  isLoading,
  onSelect,
  onNew,
}: ConversationsRailProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <p className="text-xs font-medium text-text-primary">Conversations</p>
        <button
          type="button"
          onClick={onNew}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus size={11} />
          New
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 rounded bg-white/[0.04] w-3/4" />
                <div className="h-3 rounded bg-white/[0.03] w-2/3" />
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-text-secondary/60 italic">
            No private chats yet. Start one →
          </p>
        ) : (
          conversations.map((c) => {
            const active = c.panelId === activePanelId;
            return (
              <button
                key={c.panelId}
                type="button"
                onClick={() => onSelect(c.panelId)}
                className={cn(
                  "w-full text-left px-3 py-2 transition-colors cursor-pointer block",
                  active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-medium text-text-primary truncate">
                    {c.title || "Untitled"}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-secondary/60 font-mono">
                    {c.timestamp}
                  </span>
                </div>
                <p className="text-[11px] text-text-secondary/70 truncate">
                  {c.preview}
                </p>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
