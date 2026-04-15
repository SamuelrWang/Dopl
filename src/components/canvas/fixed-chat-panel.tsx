"use client";

/**
 * FixedChatPanel — supplementary fixed right-side drawer that lists all
 * canvas chat conversations and lets the user interact with the selected
 * one. Canvas chat panels remain independently usable; this is an add-on
 * for consolidated viewing.
 */

import { useEffect, useMemo, useState } from "react";
import { usePanelsContext } from "./canvas-store";
import { useChatDrawer } from "./chat-drawer-context";
import { ChatPanelBody } from "./panels/chat/chat-panel";
import type { ChatPanelData } from "./types";

const PANEL_WIDTH = 520;
const LIST_WIDTH = 180;
const EDGE_GAP = 16;

function formatTimeShort(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expiring";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d`;
  return `${hours}h`;
}

export function FixedChatPanel() {
  const { isOpen, close } = useChatDrawer();
  const { panels } = usePanelsContext();
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);

  const chatPanels = useMemo(
    () =>
      panels
        .filter((p): p is ChatPanelData => p.type === "chat")
        .sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return 0;
        }),
    [panels]
  );

  const selectedPanel = useMemo(
    () => chatPanels.find((p) => p.id === selectedPanelId) ?? null,
    [chatPanels, selectedPanelId]
  );

  const effectivePanel = selectedPanel ?? chatPanels[0] ?? null;

  // Set CSS variable so input bar + header recenter to remaining space
  const insetPx = PANEL_WIDTH + EDGE_GAP * 2;
  useEffect(() => {
    if (isOpen) {
      document.documentElement.style.setProperty(
        "--chat-drawer-inset",
        `${insetPx}px`
      );
    } else {
      document.documentElement.style.setProperty("--chat-drawer-inset", "0px");
    }
    return () => {
      document.documentElement.style.removeProperty("--chat-drawer-inset");
    };
  }, [isOpen, insetPx]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed flex flex-col overflow-hidden rounded-2xl bg-[var(--panel-surface)] border border-white/[0.08]"
      style={{
        top: EDGE_GAP,
        right: EDGE_GAP,
        bottom: EDGE_GAP,
        width: PANEL_WIDTH,
        zIndex: 40,
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <div
        className="shrink-0 h-10 flex items-center justify-between px-4 gap-2"
        style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider text-white/50 truncate min-w-0">
          {effectivePanel?.title || "Chat"}
        </span>
        <button
          onClick={close}
          aria-label="Close chat panel"
          className="w-6 h-6 shrink-0 flex items-center justify-center rounded-[3px] text-white/40 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
        >
          <svg
            width="12"
            height="2"
            viewBox="0 0 12 2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <line x1="0" y1="1" x2="12" y2="1" />
          </svg>
        </button>
      </div>

      {/* ── Body: conversation list + divider toggle + active chat ── */}
      <div className="relative flex flex-1 min-h-0">
        {/* Left: conversation list (toggleable) */}
        {listOpen && (
          <div
            className="shrink-0 flex flex-col overflow-hidden"
            style={{
              width: LIST_WIDTH,
            }}
          >
            <div className="flex-1 overflow-y-auto">
              {chatPanels.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-white/25 font-mono">
                  No chats yet
                </div>
              ) : (
                chatPanels.map((panel) => (
                  <button
                    key={panel.id}
                    onClick={() => setSelectedPanelId(panel.id)}
                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                      effectivePanel?.id === panel.id
                        ? "bg-white/[0.08]"
                        : "hover:bg-white/[0.04]"
                    }`}
                    style={{
                      boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)",
                    }}
                  >
                    <div className="font-mono text-[11px] text-white/70 truncate leading-tight">
                      {panel.title}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[9px] text-white/25">
                        {panel.messages.filter((m) => m.type === "text").length}{" "}
                        msgs
                      </span>
                      {panel.pinned ? (
                        <span className="font-mono text-[9px] text-white/30">
                          Pinned
                        </span>
                      ) : panel.expiresAt ? (
                        <span className="font-mono text-[9px] text-white/20">
                          {formatTimeShort(panel.expiresAt)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Divider with centered toggle arrow */}
        <div className="relative shrink-0 w-px bg-white/[0.06]">
          <button
            onClick={() => setListOpen((v) => !v)}
            aria-label={listOpen ? "Hide conversations" : "Show conversations"}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-0 z-10 w-4 h-8 flex items-center justify-center rounded-full bg-[var(--panel-surface)] border border-white/[0.1] text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
          >
            <svg
              width="6"
              height="10"
              viewBox="0 0 6 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              style={{
                transform: listOpen ? undefined : "rotate(180deg)",
                transition: "transform 150ms ease",
              }}
            >
              <path d="M5 1L1 5L5 9" />
            </svg>
          </button>
        </div>

        {/* Right: active chat */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {effectivePanel ? (
            <ChatPanelBody panel={effectivePanel} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="font-mono text-[11px] text-white/20">
                No conversation selected
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
