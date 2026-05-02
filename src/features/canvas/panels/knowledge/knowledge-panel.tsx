"use client";

import { useState } from "react";
import { Bot, BookOpen, Plus } from "lucide-react";
import {
  findNonOverlappingPosition,
  nextPanelIdString,
  useCanvas,
  useCanvasScope,
} from "../../canvas-store";
import { KNOWLEDGE_BASE_PANEL_SIZE, type KnowledgePanelData } from "../../types";
import { useKnowledgeBases } from "@/features/knowledge/client/hooks";
import { useKnowledgeRealtime } from "@/features/knowledge/client/realtime";
import { createBase } from "@/features/knowledge/client/api";
import type { KnowledgeBase } from "@/features/knowledge/types";

export function KnowledgePanelBody({ panel }: { panel: KnowledgePanelData }) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const { data: bases, status, error, refetch } = useKnowledgeBases(scope?.workspaceId);
  useKnowledgeRealtime(scope?.workspaceId, refetch);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  function handleSpawnBase(base: KnowledgeBase) {
    const targetX = panel.x + panel.width + 24;
    const targetY = panel.y;
    const { x, y } = findNonOverlappingPosition(
      targetX,
      targetY,
      KNOWLEDGE_BASE_PANEL_SIZE.width,
      KNOWLEDGE_BASE_PANEL_SIZE.height,
      state.panels
    );
    dispatch({
      type: "CREATE_KNOWLEDGE_BASE_PANEL",
      id: nextPanelIdString(state),
      x,
      y,
      knowledgeBaseId: base.id,
      slug: base.slug,
      name: base.name,
      description: base.description,
      agentWriteEnabled: base.agentWriteEnabled,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateError(null);
    try {
      const base = await createBase({
        name: createName.trim(),
        description: null,
        agentWriteEnabled: false,
      });
      setCreateName("");
      setCreating(false);
      refetch();
      handleSpawnBase(base);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
            <BookOpen size={14} className="text-white/70" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">Knowledge</h2>
            <p className="text-[11px] text-white/50">
              Click a base to open it in a panel
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs text-white/80 transition-colors hover:border-white/[0.22] hover:bg-white/[0.08]"
        >
          <Plus size={12} />
          New base
        </button>
      </header>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-5 py-3"
        >
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Knowledge base name"
            className="flex-1 rounded-md border border-white/[0.1] bg-transparent px-3 py-1.5 text-xs text-white/90 placeholder:text-white/30 focus:border-white/[0.25] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="rounded-md border border-white/[0.18] bg-white/[0.08] px-3 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/[0.12] disabled:opacity-40"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setCreateName("");
              setCreateError(null);
            }}
            className="rounded-md px-2 py-1.5 text-xs text-white/50 hover:text-white/85"
          >
            Cancel
          </button>
          {createError && (
            <span className="text-[10px] text-red-400">{createError}</span>
          )}
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-5">
        {status === "loading" && !bases && (
          <div className="text-xs text-white/40">Loading…</div>
        )}
        {status === "error" && (
          <div className="text-xs text-red-400">
            {error?.message || "Failed to load knowledge bases"}
          </div>
        )}
        {bases && bases.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.12] p-8 text-center text-xs text-white/45">
            No knowledge bases yet. Click <strong>+ New base</strong> to create
            one.
          </div>
        )}
        {bases && bases.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {bases.map((base) => (
              <KnowledgeCard
                key={base.id}
                base={base}
                onClick={() => handleSpawnBase(base)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeCard({
  base,
  onClick,
}: {
  base: KnowledgeBase;
  onClick: () => void;
}) {
  const updatedAt = relativeTime(base.updatedAt);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-colors hover:border-white/[0.18] hover:bg-white/[0.05]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-white/90 group-hover:text-white/95">
          {base.name}
        </h3>
        <AgentBadge enabled={base.agentWriteEnabled} />
      </div>
      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-white/55">
        {base.description || "No description"}
      </p>
      <div className="text-[10px] uppercase tracking-wider text-white/35">
        Updated {updatedAt}
      </div>
    </button>
  );
}

function AgentBadge({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${
        enabled
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300/90"
          : "border-white/[0.08] bg-white/[0.02] text-white/40"
      }`}
    >
      <Bot size={9} />
      {enabled ? "Agent: on" : "Agent: off"}
    </span>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 2_592_000_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}
