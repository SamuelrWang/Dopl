"use client";

/**
 * IngestionPanelBody — dedicated panel for ingesting one URL end-to-end.
 *
 * Layout (top → bottom):
 *   1. URL input + Ingest button row
 *   2. Streaming log area (renders progress events from the SSE stream)
 *   3. Error or idle message
 *
 * Lifecycle:
 *   - When the user hits Ingest, useIngestionPanel starts the SSE flow.
 *   - Every progress event is pushed into the panel's logs via reducer.
 *   - On "complete", the hook fetches the entry, spawns an EntryPanel
 *     at this panel's position, and closes this panel. The user sees
 *     the ingestion panel replaced by the rich entry view in place.
 *   - On "error", status goes to "error" and the panel stays open so
 *     the user can read the error and retry.
 */

import { useEffect, useRef, useState } from "react";
import { useCanvas } from "../../canvas-store";
import type { IngestionPanelData } from "../../types";
import { useIngestionPanel } from "./use-ingestion-panel";

interface IngestionPanelBodyProps {
  panel: IngestionPanelData;
}

export function IngestionPanelBody({ panel }: IngestionPanelBodyProps) {
  const { dispatch } = useCanvas();
  const [draft, setDraft] = useState(panel.url);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const { startIngestion } = useIngestionPanel(panel);

  // Auto-focus the URL input on first mount so the user can just type.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // Auto-scroll the log as new events arrive.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [panel.logs.length]);

  // Keep the draft in sync if the reducer updates url externally
  // (e.g. page reload while streaming).
  useEffect(() => {
    if (panel.status !== "streaming") {
      setDraft(panel.url);
    }
  }, [panel.url, panel.status]);

  function handleIngest() {
    const url = draft.trim();
    if (!url || panel.status === "streaming") return;
    startIngestion(url);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleIngest();
    }
  }

  // Syncs the draft URL back into state on blur so a page reload preserves
  // what the user typed.
  function handleBlur() {
    if (draft !== panel.url) {
      dispatch({
        type: "UPDATE_INGESTION_STATE",
        panelId: panel.id,
        patch: { url: draft },
      });
    }
  }

  const canIngest = draft.trim().length > 0 && panel.status !== "streaming";

  return (
    <div
      data-no-drag
      className="flex-1 min-h-0 flex flex-col p-4 gap-3"
    >
      {/* URL input row */}
      <div className="relative rounded-xl overflow-hidden backdrop-blur-[12px] backdrop-saturate-[1.4] bg-black/[0.35] border border-white/[0.1] shadow-[0_2px_8px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] focus-within:bg-black/[0.4] focus-within:border-white/[0.18] transition-colors">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 30%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0.25) 70%, transparent 100%)",
          }}
        />
        <input
          ref={inputRef}
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={
            panel.status === "streaming"
              ? "Ingesting..."
              : "Paste a URL to ingest (X, Instagram, Reddit, GitHub, or any link)..."
          }
          disabled={panel.status === "streaming"}
          className="w-full bg-transparent px-3 pt-3 pb-1.5 text-sm leading-[20px] text-white/90 outline-none disabled:opacity-50 placeholder:text-white/30"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="font-mono text-[9px] uppercase tracking-wide text-white/30">
            {panel.status === "streaming"
              ? "Streaming"
              : panel.status === "error"
                ? "Error — edit URL and retry"
                : "Enter to ingest"}
          </span>
          <button
            type="button"
            onClick={handleIngest}
            disabled={!canIngest}
            className="inline-flex items-center h-7 px-3 font-mono text-[10px] uppercase tracking-wider text-white/70 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.12] hover:border-white/[0.22] rounded-[3px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Ingest
          </button>
        </div>
      </div>

      {/* Log area */}
      <div
        ref={logRef}
        className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-relaxed bg-black/[0.3] border border-white/[0.08] rounded-[3px] p-3 space-y-0.5"
      >
        {panel.logs.length === 0 && panel.status === "idle" && (
          <p className="text-white/30 italic uppercase tracking-wide text-[10px]">
            Paste a URL above and press Enter or click Ingest to start.
          </p>
        )}
        {panel.logs.length === 0 && panel.status === "streaming" && (
          <p className="text-white/40 animate-pulse uppercase tracking-wide text-[10px]">
            Starting...
          </p>
        )}
        {panel.logs.map((evt, i) => (
          <LogLine key={i} event={evt} />
        ))}
        {panel.status === "streaming" && panel.logs.length > 0 && (
          <div className="flex gap-2 text-white/40 animate-pulse">
            <span className="shrink-0 w-[60px]" />
            <span className="shrink-0 w-[20px] text-center">..</span>
            <span>working...</span>
          </div>
        )}
        {panel.status === "error" && panel.errorMessage && (
          <p className="mt-2 text-[color:var(--coral)] font-medium">
            Error: {panel.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Log line ───────────────────────────────────────────────────────

const eventTypeConfig: Record<
  string,
  { icon: string; className: string }
> = {
  info: { icon: "->", className: "text-white/50" },
  step_start: { icon: ">>", className: "text-blue-400 font-medium" },
  step_complete: { icon: "OK", className: "text-green-400 font-medium" },
  step_error: { icon: "!!", className: "text-red-400 font-medium" },
  detail: { icon: "  ", className: "text-white/50 pl-4" },
  complete: { icon: "**", className: "text-green-400 font-bold" },
  error: { icon: "!!", className: "text-red-400 font-bold" },
};

function LogLine({
  event,
}: {
  event: import("@/components/ingest/chat-message").ProgressEvent;
}) {
  const config = eventTypeConfig[event.type] ?? eventTypeConfig.info;
  const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className={`flex gap-2 ${config.className}`}>
      <span className="text-white/40 shrink-0 w-[60px]">{time}</span>
      <span className="shrink-0 w-[20px] text-center">{config.icon}</span>
      <span className="break-all">{event.message}</span>
    </div>
  );
}
