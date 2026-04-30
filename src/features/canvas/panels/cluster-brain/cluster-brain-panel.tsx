"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvas, useCanvasScope } from "../../canvas-store";
import type { ClusterBrainPanelData } from "../../types";

type Tab = "instructions" | "memories";

interface PersonalMemory {
  id: string;
  content: string;
}

export function ClusterBrainPanel({
  panel,
}: {
  panel: ClusterBrainPanelData;
}) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const canvasId = scope?.canvasId ?? null;

  // Look up the cluster slug for this brain panel — needed to POST
  // personal memories to /api/clusters/[slug]/brain/memories. Falls
  // back to null until the cluster's DB row has synced; the personal
  // toggle stays disabled until then.
  const clusterSlug =
    state.clusters.find((c) => c.dbId === panel.clusterId)?.slug ?? null;

  const [activeTab, setActiveTab] = useState<Tab>("instructions");
  const [newMemory, setNewMemory] = useState("");
  const [scopeChoice, setScopeChoice] = useState<"workspace" | "personal">(
    "workspace"
  );
  const [personalMemories, setPersonalMemories] = useState<PersonalMemory[]>([]);
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const lastCommittedRef = useRef(panel.instructions);

  // Pull this user's personal memories from the brain GET endpoint.
  // The response is server-filtered (workspace + own personal); we
  // discard the workspace ones because they're already in
  // panel.memories via the realtime sync and render only the personal
  // subset locally.
  useEffect(() => {
    if (!clusterSlug || !canvasId) return;
    let cancelled = false;
    fetch(`/api/clusters/${encodeURIComponent(clusterSlug)}/brain`, {
      credentials: "include",
      headers: { "X-Canvas-Id": canvasId },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          body:
            | {
                memories?: Array<{
                  id: string;
                  content: string;
                  scope?: string;
                  is_mine?: boolean;
                }>;
              }
            | null
        ) => {
          if (cancelled || !body) return;
          const mine = (body.memories ?? []).filter(
            (m) => m.scope === "personal" && m.is_mine
          );
          setPersonalMemories(
            mine.map((m) => ({ id: m.id, content: m.content }))
          );
        }
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clusterSlug, canvasId, panel.memories.length]);

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

  const handleAddMemory = useCallback(async () => {
    const trimmed = newMemory.trim();
    if (!trimmed) return;

    if (scopeChoice === "personal") {
      // Personal memories never enter panel_data (which is shared
      // with every viewer of the canvas). POST directly so the row
      // lands in cluster_brain_memories with scope='personal' and
      // shows up only in this user's brain GET payload + SKILL.md.
      if (!clusterSlug) {
        setPersonalError(
          "This cluster hasn't synced yet — try again in a moment."
        );
        return;
      }
      setSavingPersonal(true);
      setPersonalError(null);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (canvasId) headers["X-Canvas-Id"] = canvasId;
        const res = await fetch(
          `/api/clusters/${encodeURIComponent(clusterSlug)}/brain/memories`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ content: trimmed, scope: "personal" }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error?.message || body?.error || "Failed to save"
          );
        }
        const memory = (await res.json()) as {
          id: string;
          content: string;
          was_duplicate?: boolean;
        };
        // Dedup: the server returns the existing row's id when the new
        // content is a near-match (whitespace / case / punctuation
        // difference). Skip the append so React doesn't render the
        // same memory twice (and warn on duplicate keys).
        setPersonalMemories((prev) => {
          if (prev.some((m) => m.id === memory.id)) return prev;
          return [...prev, { id: memory.id, content: memory.content }];
        });
        setNewMemory("");
      } catch (err) {
        setPersonalError(
          err instanceof Error ? err.message : "Something went wrong"
        );
      } finally {
        setSavingPersonal(false);
      }
      return;
    }

    // Workspace memories follow the existing in-canvas reducer flow.
    dispatch({
      type: "ADD_CLUSTER_BRAIN_MEMORY",
      panelId: panel.id,
      memory: trimmed,
    });
    setNewMemory("");
  }, [dispatch, panel.id, newMemory, scopeChoice, clusterSlug, canvasId]);

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

  const handleRemovePersonal = useCallback(
    async (id: string) => {
      if (!clusterSlug) return;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (canvasId) headers["X-Canvas-Id"] = canvasId;
      try {
        const res = await fetch(
          `/api/clusters/${encodeURIComponent(clusterSlug)}/brain/memories`,
          {
            method: "DELETE",
            headers,
            body: JSON.stringify({ memory_id: id }),
          }
        );
        if (res.ok || res.status === 204) {
          setPersonalMemories((prev) => prev.filter((m) => m.id !== id));
        }
      } catch {
        // Silent — caller can retry. Surface an error via a toast in v2.
      }
    },
    [clusterSlug, canvasId],
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
            personalMemories={personalMemories}
            newMemory={newMemory}
            scope={scopeChoice}
            onScopeChange={setScopeChoice}
            onNewMemoryChange={setNewMemory}
            onAdd={handleAddMemory}
            onRemove={handleRemoveMemory}
            onRemovePersonal={handleRemovePersonal}
            personalError={personalError}
            saving={savingPersonal}
            personalsEnabled={Boolean(clusterSlug)}
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
  personalMemories,
  newMemory,
  scope,
  onScopeChange,
  onNewMemoryChange,
  onAdd,
  onRemove,
  onRemovePersonal,
  personalError,
  saving,
  personalsEnabled,
}: {
  memories: string[];
  personalMemories: { id: string; content: string }[];
  newMemory: string;
  scope: "workspace" | "personal";
  onScopeChange: (s: "workspace" | "personal") => void;
  onNewMemoryChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onRemovePersonal: (id: string) => void;
  personalError: string | null;
  saving: boolean;
  personalsEnabled: boolean;
}) {
  const empty = memories.length === 0 && personalMemories.length === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-3">
        {empty ? (
          <p className="py-6 text-center text-white/40">
            No memories yet. Memories are saved when the AI learns your
            preferences.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {memories.map((mem, i) => (
              <li
                key={`ws-${i}`}
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
            {personalMemories.map((m) => (
              <li
                key={`p-${m.id}`}
                className="group flex items-start gap-2 rounded-md bg-amber-500/[0.06] border border-amber-500/[0.18] px-3 py-2"
              >
                <span className="flex-1 leading-relaxed text-white/90 break-words">
                  {m.content}
                </span>
                <span className="shrink-0 mt-0.5 rounded-full bg-amber-500/[0.18] border border-amber-500/[0.3] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-200">
                  Personal
                </span>
                <button
                  onClick={() => onRemovePersonal(m.id)}
                  className="shrink-0 mt-0.5 text-white/30 transition-colors hover:text-red-400/90"
                  aria-label="Remove personal memory"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Scope toggle + add memory input */}
      <div className="shrink-0 border-t border-white/[0.08] p-3 flex flex-col gap-2">
        {personalsEnabled && (
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/50">
            <button
              onClick={() => onScopeChange("workspace")}
              className={`px-2 py-0.5 rounded-full border transition-colors ${
                scope === "workspace"
                  ? "bg-white/[0.08] border-white/[0.2] text-white"
                  : "bg-transparent border-white/[0.08] text-white/40 hover:text-white/70"
              }`}
            >
              Workspace
            </button>
            <button
              onClick={() => onScopeChange("personal")}
              className={`px-2 py-0.5 rounded-full border transition-colors ${
                scope === "personal"
                  ? "bg-amber-500/[0.18] border-amber-500/[0.3] text-amber-100"
                  : "bg-transparent border-white/[0.08] text-white/40 hover:text-white/70"
              }`}
            >
              Personal
            </button>
            {scope === "personal" && (
              <span className="text-amber-300/80 normal-case tracking-normal">
                Visible only to you.
              </span>
            )}
          </div>
        )}
        {personalError && (
          <p className="text-[10px] text-red-400">{personalError}</p>
        )}
        <div className="flex items-center gap-2">
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
            placeholder={
              scope === "personal" ? "Add a personal memory..." : "Add a memory..."
            }
            disabled={saving}
            className="min-w-0 flex-1 rounded-md bg-black/[0.3] border border-white/[0.08] px-3 py-1.5 font-mono text-[11px] text-white/90 placeholder:text-white/30 focus:border-white/[0.18] focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={onAdd}
            disabled={saving || !newMemory.trim()}
            className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 uppercase tracking-wide text-white/50 transition-colors hover:bg-white/[0.14] hover:text-white/80 disabled:opacity-40"
          >
            {saving ? "…" : "+"}
          </button>
        </div>
      </div>
    </div>
  );
}
