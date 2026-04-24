"use client";

import { useState, useRef, useCallback } from "react";
import { useCanvas } from "../../canvas-store";
import type { ClusterBrainPanelData } from "../../types";

type Tab = "instructions" | "memories";

export function ClusterBrainPanel({
  panel,
}: {
  panel: ClusterBrainPanelData;
}) {
  const { dispatch } = useCanvas();
  const [activeTab, setActiveTab] = useState<Tab>("instructions");
  const [newMemory, setNewMemory] = useState("");
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const lastCommittedRef = useRef(panel.instructions);

  // Keep the committed ref in sync when instructions change externally
  if (lastCommittedRef.current !== panel.instructions && document.activeElement !== instructionsRef.current) {
    lastCommittedRef.current = panel.instructions;
  }

  const handleInstructionsBlur = useCallback(() => {
    const el = instructionsRef.current;
    if (!el) return;
    const text = el.value;
    if (text !== lastCommittedRef.current) {
      lastCommittedRef.current = text;
      dispatch({
        type: "UPDATE_CLUSTER_BRAIN_INSTRUCTIONS_TEXT",
        panelId: panel.id,
        instructions: text,
      });
    }
  }, [dispatch, panel.id]);

  const handleAddMemory = useCallback(() => {
    const trimmed = newMemory.trim();
    if (!trimmed) return;
    dispatch({
      type: "ADD_CLUSTER_BRAIN_MEMORY",
      panelId: panel.id,
      memory: trimmed,
    });
    setNewMemory("");
  }, [dispatch, panel.id, newMemory]);

  const handleRemoveMemory = useCallback(
    (index: number) => {
      dispatch({
        type: "REMOVE_CLUSTER_BRAIN_MEMORY",
        panelId: panel.id,
        index,
      });
    },
    [dispatch, panel.id],
  );

  const handleRegenerate = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("cluster-brain:regenerate", {
        detail: { panelId: panel.id, clusterId: panel.clusterId },
      }),
    );
  }, [panel.id, panel.clusterId]);

  return (
    <div
      data-no-drag
      className="flex h-full flex-col gap-0 overflow-hidden font-mono text-[11px]"
    >
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 border-b border-white/[0.08]">
        {(["instructions", "memories"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-2 uppercase tracking-wide transition-colors ${
              activeTab === tab
                ? "border-b border-accent-primary text-white"
                : "text-white/50 hover:text-white/70"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Tab content ─────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "instructions" && (
          <InstructionsTab
            panel={panel}
            instructionsRef={instructionsRef}
            onBlur={handleInstructionsBlur}
            onRegenerate={handleRegenerate}
          />
        )}

        {activeTab === "memories" && (
          <MemoriesTab
            memories={panel.memories}
            newMemory={newMemory}
            onNewMemoryChange={setNewMemory}
            onAdd={handleAddMemory}
            onRemove={handleRemoveMemory}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Instructions tab ──────────────────────────────────────────── */

function InstructionsTab({
  panel,
  instructionsRef,
  onBlur,
  onRegenerate,
}: {
  panel: ClusterBrainPanelData;
  instructionsRef: React.RefObject<HTMLTextAreaElement | null>;
  onBlur: () => void;
  onRegenerate: () => void;
}) {
  if (panel.status === "generating") {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <span className="animate-pulse text-white/60">
          Synthesizing instructions...
        </span>
      </div>
    );
  }

  if (panel.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
        <span className="text-red-400/90">
          {panel.errorMessage ?? "Unknown error"}
        </span>
        <button
          onClick={onRegenerate}
          className="rounded-full bg-white/[0.08] px-3 py-1 uppercase tracking-wide text-white/80 transition-colors hover:bg-white/[0.14] hover:text-white"
        >
          Retry
        </button>
      </div>
    );
  }

  // status === "ready"
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <textarea
        ref={instructionsRef}
        defaultValue={panel.instructions}
        onBlur={onBlur}
        className="min-h-0 flex-1 resize-none rounded-md bg-black/[0.3] border border-white/[0.08] p-3 font-mono text-[11px] leading-relaxed text-white/90 placeholder:text-white/30 focus:border-white/[0.18] focus:outline-none"
        placeholder="No instructions yet..."
      />
      <div className="flex shrink-0 justify-end">
        <button
          onClick={onRegenerate}
          className="rounded-full bg-white/[0.08] px-3 py-1 uppercase tracking-wide text-white/50 transition-colors hover:bg-white/[0.14] hover:text-white/80"
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}

/* ─── Memories tab ──────────────────────────────────────────────── */

function MemoriesTab({
  memories,
  newMemory,
  onNewMemoryChange,
  onAdd,
  onRemove,
}: {
  memories: string[];
  newMemory: string;
  onNewMemoryChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-3">
        {memories.length === 0 ? (
          <p className="py-6 text-center text-white/40">
            No memories yet. Memories are saved when the AI learns your
            preferences.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {memories.map((mem, i) => (
              <li
                key={i}
                className="group flex items-start gap-2 rounded-md bg-black/[0.3] border border-white/[0.08] px-3 py-2"
              >
                <span className="flex-1 leading-relaxed text-white/90 break-words">
                  {mem}
                </span>
                <button
                  onClick={() => onRemove(i)}
                  className="shrink-0 mt-0.5 text-white/30 transition-colors hover:text-red-400/90"
                  aria-label="Remove memory"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add memory input */}
      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.08] p-3">
        <input
          type="text"
          value={newMemory}
          onChange={(e) => onNewMemoryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="Add a memory..."
          className="min-w-0 flex-1 rounded-md bg-black/[0.3] border border-white/[0.08] px-3 py-1.5 font-mono text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/[0.18] focus:outline-none"
        />
        <button
          onClick={onAdd}
          className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 uppercase tracking-wide text-white/50 transition-colors hover:bg-white/[0.14] hover:text-white/80"
        >
          +
        </button>
      </div>
    </div>
  );
}
