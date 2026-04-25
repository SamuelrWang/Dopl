"use client";

/**
 * Right-side slide-in panel that renders a full entry without leaving
 * the browse page. Opened by EntryCard clicks via EntryPreviewContext.
 *
 * Perf note: the panel shell + backdrop are ALWAYS mounted and toggled
 * via a CSS transition on `transform` / `opacity`. An earlier version
 * used tailwindcss-animate's `animate-in slide-in-from-right` keyframe,
 * but keyframes only start playing after React mounts the element —
 * in dev mode the mount cost (strict-mode double effects, unminified
 * React, HMR) pushed the first couple of animation frames off, which
 * visibly stuttered the slide. A transition on an already-mounted
 * element runs entirely on the compositor and doesn't wait on React.
 *
 * - Escape + backdrop click close the panel.
 * - ⌘/Ctrl/middle-click on a card still open the full /entries/<id>
 *   page in a new tab (handled in EntryCard).
 */

import { useCallback, useEffect, useState } from "react";
import { EntryDetail } from "./entry-detail";
import {
  useEntryPreviewActions,
  useEntryPreviewId,
} from "./entry-preview-context";

interface FullEntry {
  id: string;
  title: string | null;
  summary: string | null;
  source_url: string;
  source_author: string | null;
  use_case: string | null;
  complexity: string | null;
  status: string;
  readme: string | null;
  agents_md: string | null;
  content_type: string | null;
  manifest: Record<string, unknown> | null;
  raw_content: Record<string, unknown> | null;
  created_at: string;
  ingested_at: string | null;
  sources: {
    source_type: string;
    url: string | null;
    raw_content: string | null;
    extracted_content: string | null;
  }[];
  tags: { tag_type: string; tag_value: string }[];
}

const PANEL_WIDTH = 640;
const TRANSITION_MS = 200;

export function EntryPreviewPanel() {
  const previewId = useEntryPreviewId();
  const actions = useEntryPreviewActions();
  const closePreview = actions?.closePreview;
  const isOpen = previewId !== null;

  const [entry, setEntry] = useState<FullEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the body mounted for the duration of the slide-out so its
  // contents don't visually disappear mid-animation. Goes true
  // immediately on open; goes false only after the slide-out finishes.
  const [bodyMounted, setBodyMounted] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setBodyMounted(true);
      return;
    }
    const t = window.setTimeout(() => setBodyMounted(false), TRANSITION_MS);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  // Escape-to-close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, closePreview]);

  // Fetch the entry whenever the previewed id changes. Cancel-on-unmount
  // guard prevents setting state for a stale id if the user rapid-fires
  // through several cards.
  useEffect(() => {
    if (!previewId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntry(null);
    fetch(`/api/entries/${encodeURIComponent(previewId)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Entry not found");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load entry");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewId]);

  const handleBackdropClick = useCallback(() => {
    closePreview?.();
  }, [closePreview]);

  return (
    <>
      {/* Backdrop — always in the DOM, toggled via opacity + pointer
          events so the fade is a cheap compositor op. Hidden from
          layout/paint entirely once the fade-out settles.
          No backdrop-filter: the 2px blur was forcing a per-frame
          recomposite of the grid behind during the slide animation,
          and again on any repaint below (hover states, infinite
          scroll). Solid tint only. */}
      <div
        aria-hidden
        onClick={handleBackdropClick}
        className="fixed inset-0 bg-black/55 z-40"
        style={{
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          visibility: bodyMounted ? "visible" : "hidden",
          transition: `opacity ${TRANSITION_MS}ms ease-out`,
        }}
      />

      {/* Panel shell — always mounted. When closed, it's translated
          off-screen past the right edge. Transition lives on the
          element, not on its mount, so it's smooth even in dev.
          `visibility: hidden` post-transition removes the off-screen
          panel from the document's scrollable width (fixed elements
          still contribute to overflow) and from the compositor —
          otherwise it leaks horizontal scroll and keeps a layer live. */}
      <aside
        role="dialog"
        aria-label="Entry preview"
        aria-hidden={!isOpen}
        className="fixed top-4 right-4 bottom-4 z-50 flex flex-col rounded-2xl bg-[var(--panel-surface,#0a0a0a)] border border-white/[0.08] overflow-hidden"
        style={{
          width: `min(${PANEL_WIDTH}px, calc(100vw - 32px))`,
          // Slide past the right edge + margin + shadow so nothing peeks.
          transform: isOpen
            ? "translate3d(0,0,0)"
            : "translate3d(calc(100% + 32px), 0, 0)",
          transition: `transform ${TRANSITION_MS}ms ease-out`,
          willChange: isOpen ? "transform" : "auto",
          pointerEvents: isOpen ? "auto" : "none",
          visibility: bodyMounted ? "visible" : "hidden",
          boxShadow:
            "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        {/* Top bar */}
        <div
          className="shrink-0 h-10 flex items-center justify-between px-4 gap-2"
          style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/50 truncate">
            Entry Preview
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {previewId && (
              <a
                href={`/entries/${previewId}`}
                target="_blank"
                rel="noopener"
                className="px-2 h-6 flex items-center font-mono text-[10px] uppercase tracking-wide rounded-[3px] text-white/50 hover:text-white/90 hover:bg-white/[0.08] transition-colors"
                title="Open full page in new tab"
              >
                Open ↗
              </a>
            )}
            <button
              onClick={closePreview}
              aria-label="Close preview"
              className="w-6 h-6 flex items-center justify-center rounded-[3px] text-white/40 hover:text-white/80 hover:bg-white/[0.08] transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <line x1="2" y1="2" x2="10" y2="10" />
                <line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body — gated on `bodyMounted` so the slide-out can finish
            before its content is torn down. `overscroll-contain`
            stops scroll from chaining into the /browse grid behind;
            without it, hitting top/bottom of the panel drives the
            background list and its infinite-scroll observer, which
            was the real lag source. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5">
          {bodyMounted && (
            <>
              {loading && (
                <div className="flex items-center justify-center h-full">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-white/40">
                    Loading entry...
                  </p>
                </div>
              )}
              {!loading && error && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}
              {!loading && !error && entry && <EntryDetail entry={entry} />}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
