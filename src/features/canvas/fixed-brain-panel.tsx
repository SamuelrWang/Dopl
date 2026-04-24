"use client";

/**
 * FixedBrainPanel — fixed right-side drawer that lists all cluster brains
 * and lets the user view/edit the selected one. Mirrors FixedChatPanel layout.
 */

import { useMemo, useState } from "react";
import { usePanelsContext } from "./canvas-store";
import { useBrainDrawer } from "./chat-drawer-context";
import { ClusterBrainPanel } from "./panels/cluster-brain/cluster-brain-panel";
import type { ClusterBrainPanelData } from "./types";

const PANEL_WIDTH = 520;
const LIST_WIDTH = 180;
const EDGE_GAP = 16;

export function FixedBrainPanel() {
  const { isOpen, close } = useBrainDrawer();
  const { panels, clusters } = usePanelsContext();
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(true);

  // Build brain panel list with live cluster names from the clusters array
  const brainPanels = useMemo(() => {
    const clusterMap = new Map(clusters.map((c) => [c.id, c.name]));
    return panels
      .filter((p): p is ClusterBrainPanelData => p.type === "cluster-brain")
      .map((p) => ({
        ...p,
        // Prefer the live cluster name, fall back to the panel's stored name
        displayName: clusterMap.get(p.clusterId) ?? p.clusterName,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [panels, clusters]);

  const selectedPanel = useMemo(
    () => brainPanels.find((p) => p.id === selectedPanelId) ?? null,
    [brainPanels, selectedPanelId],
  );

  const effectivePanel = selectedPanel ?? brainPanels[0] ?? null;

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
          {effectivePanel ? `Brain: ${effectivePanel.displayName}` : "Brain"}
        </span>
        <button
          onClick={close}
          aria-label="Close brain panel"
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

      {/* ── Body: brain list + divider toggle + active brain ── */}
      <div className="relative flex flex-1 min-h-0">
        {/* Left: brain list (toggleable) */}
        {listOpen && (
          <div
            className="shrink-0 flex flex-col overflow-hidden"
            style={{ width: LIST_WIDTH }}
          >
            <div className="flex-1 overflow-y-auto">
              {brainPanels.length === 0 ? (
                <div className="px-3 py-4 text-[11px] text-white/25 font-mono">
                  No cluster brains yet. Create a cluster to get started.
                </div>
              ) : (
                brainPanels.map((panel) => (
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
                      {panel.displayName}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[9px] text-white/25">
                        {panel.memories.length} memories
                      </span>
                      <span className="font-mono text-[9px] text-white/20">
                        {panel.status === "ready"
                          ? "Ready"
                          : panel.status === "generating"
                          ? "Generating..."
                          : "Error"}
                      </span>
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
            aria-label={listOpen ? "Hide brain list" : "Show brain list"}
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

        {/* Right: active brain */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {effectivePanel ? (
            <ClusterBrainPanel panel={effectivePanel} />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="font-mono text-[11px] text-white/20">
                No brain selected
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
