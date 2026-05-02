"use client";

import { Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";

interface MockConversation {
  id: string;
  title: string;
  preview: string;
  timestamp: string;
}

const MOCK_CONVERSATIONS: ReadonlyArray<MockConversation> = [
  {
    id: "c1",
    title: "Polymarket bot setup",
    preview: "Walk me through the CLOB auth flow…",
    timestamp: "2m",
  },
  {
    id: "c2",
    title: "Refactor canvas store",
    preview: "Reducer is over 800 lines, what would…",
    timestamp: "1h",
  },
  {
    id: "c3",
    title: "MCP onboarding copy",
    preview: "Draft three lines for the install card",
    timestamp: "3h",
  },
  {
    id: "c4",
    title: "Q4 launch checklist",
    preview: "Pull the open finds from REFACTOR…",
    timestamp: "1d",
  },
  {
    id: "c5",
    title: "Stripe webhook bug",
    preview: "Signature verification fails when…",
    timestamp: "2d",
  },
  {
    id: "c6",
    title: "Untitled",
    preview: "Hi",
    timestamp: "5d",
  },
];

const ACTIVE_ID = "c1";

export function ConversationsRail() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
        <p className="text-xs font-medium text-text-primary">Conversations</p>
        <button
          type="button"
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus size={11} />
          New
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {MOCK_CONVERSATIONS.map((c) => {
          const active = c.id === ACTIVE_ID;
          return (
            <button
              key={c.id}
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 transition-colors cursor-pointer block",
                active ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-xs font-medium text-text-primary truncate">
                  {c.title}
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
        })}
      </div>
    </div>
  );
}
