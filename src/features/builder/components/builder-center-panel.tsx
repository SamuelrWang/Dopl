"use client";

import { useState, useMemo, useEffect } from "react";
import { usePanelsContext } from "@/features/canvas/canvas-store";
import { ChatPanelBody } from "@/features/chat/components/chat-panel";
import type { Cluster, ChatPanelData } from "@/features/canvas/types";

interface BuilderCenterPanelProps {
  cluster: Cluster | null;
}

export function BuilderCenterPanel({ cluster }: BuilderCenterPanelProps) {
  const { panels } = usePanelsContext();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const chatPanels = useMemo(() => {
    if (!cluster) return [];
    return cluster.panelIds
      .map((pid) => panels.find((p) => p.id === pid))
      .filter((p): p is ChatPanelData => p?.type === "chat");
  }, [cluster, panels]);

  useEffect(() => {
    if (chatPanels.length === 0) {
      setActiveChatId(null);
      return;
    }
    const exists = chatPanels.some((p) => p.id === activeChatId);
    if (!exists) {
      setActiveChatId(chatPanels[0].id);
    }
  }, [chatPanels, activeChatId]);

  const activeChatPanel = useMemo(
    () => chatPanels.find((p) => p.id === activeChatId) ?? null,
    [chatPanels, activeChatId],
  );

  if (!cluster) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] text-white/25 font-mono uppercase tracking-wider">
          Select a cluster to chat
        </p>
      </div>
    );
  }

  if (chatPanels.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] text-white/25 font-mono uppercase tracking-wider">
          No conversations yet
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar — only if multiple chats */}
      {chatPanels.length > 1 && (
        <div className="shrink-0 h-10 flex items-center px-2 gap-0" style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}>
          {chatPanels.map((cp) => (
            <button
              key={cp.id}
              onClick={() => setActiveChatId(cp.id)}
              className={`relative h-full px-3 text-[10px] font-mono uppercase tracking-wider transition-colors truncate max-w-[200px] ${
                cp.id === activeChatId
                  ? "text-white/85"
                  : "text-white/35 hover:text-white/55"
              }`}
            >
              {cp.title || "Untitled"}
              {cp.id === activeChatId && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-[var(--accent-primary)]" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Chat body — key forces remount per panel for correct hook binding */}
      {activeChatPanel && (
        <div className="flex-1 min-h-0 flex flex-col" key={activeChatPanel.id}>
          <ChatPanelBody panel={activeChatPanel} />
        </div>
      )}
    </div>
  );
}
