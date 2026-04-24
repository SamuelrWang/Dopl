"use client";

import React, { useCallback } from "react";
import type { CanvasAction, ChatPanelData } from "./types";

function formatTimeRemaining(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring soon";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  return `Expires in ${hours}h`;
}

export function ChatExpiryBar({
  panel,
  dispatch,
}: {
  panel: ChatPanelData;
  dispatch: React.Dispatch<CanvasAction>;
}) {
  const isPinned = panel.pinned ?? false;

  const handleTogglePin = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      dispatch({
        type: "SET_CHAT_PINNED",
        panelId: panel.id,
        pinned: !isPinned,
      });
    },
    [dispatch, panel.id, isPinned]
  );

  return (
    <div className="shrink-0 flex items-center justify-between px-4 h-6 border-b border-white/[0.04] bg-white/[0.02]">
      <span className="font-mono text-[9px] uppercase tracking-wider text-white/30">
        {isPinned
          ? "Pinned"
          : panel.expiresAt
            ? formatTimeRemaining(panel.expiresAt)
            : "Expires in 7d 0h"}
      </span>
      <button
        onClick={handleTogglePin}
        aria-label={isPinned ? "Unpin chat" : "Pin chat"}
        title={isPinned ? "Unpin — will auto-delete after 7 days" : "Pin — keep forever"}
        className="w-5 h-5 flex items-center justify-center rounded-[2px] text-white/30 hover:text-white/70 transition-colors"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill={isPinned ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M5 1v6M3 3l2-2 2 2M2 7h6M5 7v2" />
        </svg>
      </button>
    </div>
  );
}
