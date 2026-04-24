"use client";

import { useState, useEffect, useMemo } from "react";
import { usePanelsContext } from "@/features/canvas/canvas-store";
import { BuilderSidebar } from "./builder-sidebar";
import { BuilderCenterPanel } from "./builder-center-panel";
import { BuilderRightPanel } from "./builder-right-panel";

export function BuilderLayout() {
  const { clusters } = usePanelsContext();
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  useEffect(() => {
    if (clusters.length === 0) {
      setActiveClusterId(null);
      return;
    }
    const exists = clusters.some((c) => c.id === activeClusterId);
    if (!exists) {
      setActiveClusterId(clusters[0].id);
    }
  }, [clusters, activeClusterId]);

  const activeCluster = useMemo(
    () => clusters.find((c) => c.id === activeClusterId) ?? null,
    [clusters, activeClusterId],
  );

  // Empty state
  if (clusters.length === 0) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="relative flex flex-col items-center gap-6 text-center max-w-sm">
          <div className="relative">
            <div className="w-14 h-14 rounded-2xl bg-[var(--card-surface)] border border-white/[0.12] shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] flex items-center justify-center">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white/50"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            </div>
            <div className="absolute inset-0 rounded-2xl bg-[var(--accent-primary)] opacity-[0.06] blur-xl" />
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-medium text-white/90">
              Create your first cluster
            </h2>
            <p className="text-xs text-white/40 leading-relaxed max-w-[280px]">
              Clusters group entries, conversations, and a synthesized brain
              into a single workspace.
            </p>
          </div>
          <BuilderSidebar
            activeClusterId={null}
            onSelectCluster={setActiveClusterId}
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left sidebar */}
      <aside className="w-[240px] shrink-0 bg-[var(--bg-inset)] flex flex-col">
        <BuilderSidebar
          activeClusterId={activeClusterId}
          onSelectCluster={setActiveClusterId}
        />
      </aside>

      {/* Divider */}
      <div className="w-px shrink-0 bg-white/[0.06]" />

      {/* Center — chat fills the space */}
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-base)]">
        <BuilderCenterPanel cluster={activeCluster} />
      </main>

      {/* Divider */}
      <div className="w-px shrink-0 bg-white/[0.06]" />

      {/* Right panel */}
      <aside className="w-[380px] shrink-0 bg-[var(--bg-inset)] flex flex-col">
        <BuilderRightPanel cluster={activeCluster} />
      </aside>
    </div>
  );
}
