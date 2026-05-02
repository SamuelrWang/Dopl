"use client";

import { ChatThread } from "./chat-thread";
import { ConversationsRail } from "./conversations-rail";

export function ChatShell() {
  return (
    <div className="fixed top-[52px] right-0 bottom-0 left-0 md:left-64 z-[3] p-3 pointer-events-auto">
      <div className="h-full rounded-2xl border border-white/[0.1] bg-[var(--panel-surface)] overflow-hidden flex">
        <aside className="w-56 shrink-0 flex flex-col border-r border-white/[0.08]">
          <ConversationsRail />
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <ChatThread />
        </div>
      </div>
    </div>
  );
}
