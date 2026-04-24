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

import { useEffect, useRef, useState, useCallback } from "react";
import {
  computeNewPanelPosition,
  nextPanelIdString,
  useCanvas,
} from "./canvas-store";
import { BROWSE_PANEL_SIZE, DEFAULT_PANEL_SIZE, MAX_ZOOM, MIN_ZOOM } from "./types";
import { useSpeechRecognition } from "@/shared/hooks/use-speech-recognition";
import { useChatDrawer, useBrainDrawer } from "./chat-drawer-context";

export function FixedInputBar() {
  const { state, dispatch } = useCanvas();
  const { isOpen: chatOpen, toggle: toggleChatDrawer } = useChatDrawer();
  const { isOpen: brainOpen, toggle: toggleBrainDrawer } = useBrainDrawer();
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const {
    isListening,
    fullText,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    clearTranscript,
    error: voiceError,
  } = useSpeechRecognition();

  const prevFullTextRef = useRef("");

  // Live-sync voice transcript into the textarea
  useEffect(() => {
    if (isListening && fullText !== prevFullTextRef.current) {
      prevFullTextRef.current = fullText;
      setInput(fullText);
    }
  }, [isListening, fullText]);

  const handleVoiceToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      // final text is already in input via the live-sync effect
      prevFullTextRef.current = "";
    } else {
      clearTranscript();
      prevFullTextRef.current = "";
      startListening();
    }
  }, [isListening, stopListening, clearTranscript, startListening]);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // Pick up a pending message from the landing page (stored before login redirect)
  const landingMessageHandled = useRef(false);
  useEffect(() => {
    if (landingMessageHandled.current) return;
    const pending = localStorage.getItem("dopl-landing-message");
    if (!pending) return;
    landingMessageHandled.current = true;
    localStorage.removeItem("dopl-landing-message");
    // Delay briefly so the canvas store is fully initialized
    setTimeout(() => {
      spawnChatPanel(pending);
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const title = "New Chat";
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
    if (isListening) {
      stopListening();
      clearTranscript();
      prevFullTextRef.current = "";
    }
    setInput("");
    spawnChatPanel(text);
  }

  /** Spawn a new empty chat panel without sending anything. */
  function handleSpawnChat() {
    spawnChatPanel();
  }

  /**
   * Spawn a new browse panel at the camera viewport center — OR, if one
   * already exists, frame the camera on the existing panel so it fills
   * the viewport. Only one browse panel is allowed at a time.
   */
  function handleSpawnBrowse() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const existing = state.panels.find((p) => p.type === "browse");
    if (existing) {
      // Fit-to-viewport zoom with 10% margin, clamped to canvas limits.
      const fitZoom = Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.min(vw / existing.width, vh / existing.height) * 0.9
        )
      );
      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: -(existing.x + existing.width / 2) * fitZoom + vw / 2,
          y: -(existing.y + existing.height / 2) * fitZoom + vh / 2,
          zoom: fitZoom,
        },
      });
      dispatch({ type: "SET_SELECTION", panelIds: [existing.id] });
      return;
    }

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
        transform: "translateX(calc(var(--chat-drawer-inset, 0px) / -2))",
        transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: "transform",
      }}
    >
      <div className="w-[95%] md:w-3/4 max-w-3xl pointer-events-auto">
        <div
          className="relative rounded-2xl overflow-hidden backdrop-blur-xl border border-white/[0.1] shadow-[0_4px_16px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-200 focus-within:border-white/[0.18]"
          style={{ backgroundColor: "oklch(0.13 0 0 / 0.5)" }}
        >
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
              {/* CHAT pill — opens the fixed chat drawer */}
              <button
                onClick={toggleChatDrawer}
                aria-label="Toggle chat panel"
                className={`inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider rounded-full transition-colors border ${
                  chatOpen
                    ? "text-white/90 bg-white/[0.12] border-white/[0.25]"
                    : "text-white/60 hover:text-white/95 bg-white/[0.04] hover:bg-white/[0.09] border-white/[0.12] hover:border-white/[0.22]"
                }`}
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
              {/* BRAIN pill — opens the fixed brain drawer */}
              <button
                onClick={toggleBrainDrawer}
                aria-label="Toggle brain panel"
                className={`inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider rounded-full transition-colors border ${
                  brainOpen
                    ? "text-white/90 bg-white/[0.12] border-white/[0.25]"
                    : "text-white/60 hover:text-white/95 bg-white/[0.04] hover:bg-white/[0.09] border-white/[0.12] hover:border-white/[0.22]"
                }`}
              >
                Brain
              </button>
            </div>
            <div className="flex items-center gap-2">
              {/* Voice input — bare icon, no button chrome */}
              {voiceSupported && (
                <button
                  type="button"
                  onClick={handleVoiceToggle}
                  aria-label={isListening ? "Stop recording" : "Start voice input"}
                  title={
                    voiceError
                      ? voiceError
                      : isListening
                      ? "Recording... click to stop"
                      : "Voice input"
                  }
                  className="flex items-center justify-center w-7 h-7 transition-colors"
                >
                  {isListening ? (
                    <span className="flex items-end gap-[2px] h-4">
                      {[1, 2, 3, 4, 3].map((h, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full bg-red-400"
                          style={{
                            height: `${h * 3}px`,
                            animation: `voiceBar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                          }}
                        />
                      ))}
                    </span>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="w-4 h-4 text-white/40 hover:text-white/70 transition-colors"
                    >
                      <rect x="9" y="2" width="6" height="12" rx="3" />
                      <path d="M5 10a7 7 0 0 0 14 0" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                      <line x1="8" y1="22" x2="16" y2="22" />
                    </svg>
                  )}
                </button>
              )}
              {/* Send — circular */}
              <button
                onClick={handleSend}
                disabled={!canSend}
                aria-label="Send"
                className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white/90 border border-white/[0.12] hover:border-white/[0.22] rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-white/[0.04] hover:bg-white/[0.08]"
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
      {isListening && (
        <style>{`
          @keyframes voiceBar {
            from { transform: scaleY(0.5); }
            to   { transform: scaleY(1.5); }
          }
        `}</style>
      )}
    </div>
  );
}
