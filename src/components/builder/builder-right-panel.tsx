"use client";

import { useMemo, useState } from "react";
import { usePanelsContext } from "@/components/canvas/canvas-store";
import { ClusterBrainPanel } from "@/components/canvas/panels/cluster-brain/cluster-brain-panel";
import { MarkdownMessage } from "@/components/design/markdown-message";
import type {
  Cluster,
  EntryPanelData,
  ClusterBrainPanelData,
} from "@/components/canvas/types";

interface BuilderRightPanelProps {
  cluster: Cluster | null;
}

type RightTab = "brain" | "entries";

export function BuilderRightPanel({ cluster }: BuilderRightPanelProps) {
  const { panels } = usePanelsContext();
  const [activeTab, setActiveTab] = useState<RightTab>("brain");

  const { entryPanels, brainPanel } = useMemo(() => {
    if (!cluster) return { entryPanels: [], brainPanel: null };

    const entries: EntryPanelData[] = [];
    let brain: ClusterBrainPanelData | null = null;

    for (const pid of cluster.panelIds) {
      const p = panels.find((pp) => pp.id === pid);
      if (!p) continue;
      if (p.type === "entry") entries.push(p);
      if (p.type === "cluster-brain") brain = p;
    }

    return { entryPanels: entries, brainPanel: brain };
  }, [cluster, panels]);

  if (!cluster) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[11px] text-white/25 font-mono uppercase tracking-wider">
          Cluster details
        </p>
      </div>
    );
  }

  const tabs: { key: RightTab; label: string }[] = [
    { key: "brain", label: "Brain" },
    {
      key: "entries",
      label: entryPanels.length > 0 ? `Entries (${entryPanels.length})` : "Entries",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header: cluster name + tabs in one compact bar */}
      <div className="shrink-0">
        <div
          className="h-10 flex items-center gap-4 px-4"
          style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.06)" }}
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/40 shrink-0">
            {cluster.name}
          </span>

          <div className="h-3 w-px bg-white/[0.08]" />

          <div className="flex items-center gap-0">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative h-10 px-2 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                  activeTab === tab.key
                    ? "text-white/80"
                    : "text-white/30 hover:text-white/50"
                }`}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-[var(--accent-primary)]" />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "brain" && <BrainTab brainPanel={brainPanel} />}
        {activeTab === "entries" && <EntriesTab entries={entryPanels} />}
      </div>
    </div>
  );
}

// ── Brain tab ─────────────────────────────────────────────────────

function BrainTab({
  brainPanel,
}: {
  brainPanel: ClusterBrainPanelData | null;
}) {
  if (!brainPanel) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[11px] text-white/25 font-mono uppercase tracking-wider">
          No brain panel
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ClusterBrainPanel panel={brainPanel} />
    </div>
  );
}

// ── Entries tab ───────────────────────────────────────────────────

function EntriesTab({ entries }: { entries: EntryPanelData[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6">
        <p className="text-[11px] text-white/25 font-mono uppercase tracking-wider text-center">
          No entries yet
        </p>
        <p className="text-[10px] text-white/15 mt-1.5 text-center max-w-[200px] leading-relaxed">
          Paste a URL in the chat to ingest entries into this cluster.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {entries.map((entry, i) => (
        <EntryRow key={entry.id} entry={entry} isLast={i === entries.length - 1} />
      ))}
    </div>
  );
}

// ── Entry row — flat list style, not cards ────────────────────────

function EntryRow({
  entry,
  isLast,
}: {
  entry: EntryPanelData;
  isLast: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="px-4 py-3 hover:bg-white/[0.02] transition-colors"
      style={!isLast ? { boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)" } : undefined}
    >
      {/* Title + platform */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/80 leading-snug line-clamp-1">
          {entry.title || "Untitled"}
        </h3>
        {entry.sourcePlatform && (
          <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-white/25">
            {entry.sourcePlatform}
          </span>
        )}
      </div>

      {/* Summary */}
      {entry.summary && (
        <p className="text-[11px] text-white/35 line-clamp-2 mt-1 leading-relaxed">
          {entry.summary}
        </p>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {entry.tags.slice(0, 4).map((tag, i) => (
            <span
              key={i}
              className="font-mono text-[8px] text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded-[3px]"
            >
              {tag.value}
            </span>
          ))}
          {entry.tags.length > 4 && (
            <span className="font-mono text-[8px] text-white/20">
              +{entry.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 mt-2">
        {entry.sourceUrl && (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[9px] uppercase tracking-wider text-[var(--accent-primary)] opacity-60 hover:opacity-100 transition-opacity"
          >
            Source
          </a>
        )}
        {entry.readme && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="font-mono text-[9px] uppercase tracking-wider text-white/30 hover:text-white/50 transition-colors"
          >
            {expanded ? "Hide" : "README"}
          </button>
        )}
      </div>

      {/* Expanded README */}
      {expanded && entry.readme && (
        <div className="mt-2 p-3 rounded-lg bg-black/[0.2] border border-white/[0.04] max-h-[240px] overflow-y-auto">
          <MarkdownMessage content={entry.readme} />
        </div>
      )}
    </div>
  );
}
