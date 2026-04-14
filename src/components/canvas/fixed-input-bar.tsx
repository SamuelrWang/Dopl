"use client";

/**
 * FixedInputBar — bottom-fixed input that spawns a NEW ChatPanel for each
 * URL the user sends. Uses the same dark-glass styling and dimensions as
 * the previous IngestChat input bar (which already matches openclaw spec).
 *
 * Sending here:
 *  1. Computes a spawn position at the camera viewport center (in world coords)
 *  2. Dispatches CREATE_CHAT_PANEL
 *  3. Calls startPanelIngestion(dispatch, panelId, url) to begin the ingestion
 */

import { useEffect, useRef, useState } from "react";
import {
  computeNewPanelPosition,
  nextPanelIdString,
  useCanvas,
} from "./canvas-store";
import {
  extractUrl,
  isUrlOnlyMessage,
} from "./panels/chat/url-detection";
import { startPanelIngestion } from "./use-panel-ingestion";
import { BROWSE_PANEL_SIZE, DEFAULT_PANEL_SIZE } from "./types";

export function FixedInputBar() {
  const { state, dispatch } = useCanvas();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  /**
   * Spawn a ChatPanel at the camera viewport center. If `pendingInput` is
   * provided, the panel consumes it on mount and fires a normal chat (or
   * URL-ingest) flow — letting the user start a real conversation from
   * the bottom bar without needing to type the message again inside the
   * panel itself.
   */
  function spawnChatPanel(pendingInput?: string): string {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      DEFAULT_PANEL_SIZE.width,
      DEFAULT_PANEL_SIZE.height
    );
    const id = nextPanelIdString(state);
    const title = `Chat #${state.nextPanelId}`;
    dispatch({
      type: "CREATE_CHAT_PANEL",
      id,
      x,
      y,
      title,
      pendingInput,
    });
    return id;
  }

  /**
   * Route the user's typed input:
   *   - Bare URL (nothing else)   → spawn chat + kick off ingestion inline
   *     (preserves the "paste a link to ingest" shortcut)
   *   - Anything else             → spawn chat + hand it the message as
   *     `pendingInput`; the new chat panel fires /api/chat on mount
   */
  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (isUrlOnlyMessage(text)) {
      const id = spawnChatPanel();
      startPanelIngestion(dispatch, id, extractUrl(text));
    } else {
      spawnChatPanel(text);
    }
  }

  /** Spawn a new empty chat panel without sending anything. */
  function handleSpawnChat() {
    spawnChatPanel();
  }

  /** Spawn a new browse panel at the camera viewport center. */
  function handleSpawnBrowse() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { x, y } = computeNewPanelPosition(
      state,
      vw,
      vh,
      BROWSE_PANEL_SIZE.width,
      BROWSE_PANEL_SIZE.height
    );
    const id = `browse-${state.nextPanelId}`;
    dispatch({ type: "CREATE_BROWSE_PANEL", id, x, y });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = input.trim().length > 0;

  return (
    <div
      className="fixed bottom-4 left-0 right-0 z-30 flex justify-center px-4 pointer-events-none"
      style={{
        transform: "translateX(calc(var(--sidebar-right-inset, 0px) / -2))",
        transition: "transform 200ms cubic-bezier(0.4, 0, 0.2, 1)",
        willChange: "transform",
      }}
    >
      <div className="w-[95%] md:w-3/4 max-w-3xl pointer-events-auto">
        <div className="relative rounded-2xl overflow-hidden backdrop-blur-[12px] backdrop-saturate-[1.4] bg-black/[0.25] border border-white/[0.1] shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-200 focus-within:bg-black/[0.3] focus-within:border-white/[0.18]">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 30%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.3) 70%, transparent 100%)",
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything or paste a URL..."
            rows={1}
            className="w-full bg-transparent px-4 pt-4 pb-2 text-base leading-[24px] text-white/90 outline-none resize-none placeholder:text-white/30 disabled:opacity-50 min-h-[48px] max-h-[200px]"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            {/* Left pill group — Chat + Browse */}
            <div className="inline-flex items-center gap-2">
              {/* CHAT pill — spawns an empty chat panel on the canvas */}
              <button
                onClick={handleSpawnChat}
                aria-label="Spawn chat panel"
                className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-white/60 hover:text-white/95 bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors"
              >
                Chat
              </button>
              {/* BROWSE pill — spawns a browse/search panel */}
              <button
                onClick={handleSpawnBrowse}
                aria-label="Spawn browse panel"
                className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-white/60 hover:text-white/95 bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors"
              >
                Browse
              </button>
            </div>
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send"
              className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-[3px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M7 11V3" />
                <path d="M3 7l4-4 4 4" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
