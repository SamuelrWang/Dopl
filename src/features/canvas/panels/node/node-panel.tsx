"use client";

/**
 * NodePanelBody — a workflow step block.
 *
 * Layout (top → bottom):
 *   - title + description (free text, autosaved via UPDATE_NODE_FIELDS)
 *   - READ   — dock zone for knowledge (KB panels or file chips)
 *   - ACTION — dock zone for skills
 *   - USER INPUT / AGENT OUTPUT / NEXT NODE — labeled textareas
 *
 * Dock zones carry `data-dock-zone` + `data-dock-panel-id` attributes;
 * the panel-drag hook (use-canvas-panel-drag) and the file-chip drag
 * (use-ref-chip-drag) hit-test those via elementsFromPoint and dispatch
 * NODE_DOCK_REF on drop. The zones light up via [data-dock-active].
 *
 * Field persistence rides the canvas_panels panel_data debounce sync —
 * every UPDATE_NODE_FIELDS lands in panel_data within ~2s.
 */

import { useState } from "react";
import { BookOpen, FileText, Sparkles, X } from "lucide-react";
import { useCanvas } from "../../canvas-store";
import type {
  KnowledgeBasePanelData,
  NodePanelData,
  NodeRef,
} from "../../types";
import { nodeRefKey } from "../../types";
import { KnowledgeBasePanelBody } from "../knowledge-base/knowledge-base-panel";

export function NodePanelBody({ panel }: { panel: NodePanelData }) {
  const { dispatch } = useCanvas();

  function patch(fields: Partial<Pick<NodePanelData, "title" | "description" | "userInput" | "agentOutput" | "nextInstructions">>) {
    dispatch({ type: "UPDATE_NODE_FIELDS", panelId: panel.id, patch: fields });
  }

  function undock(zone: "read" | "action", ref: NodeRef) {
    dispatch({
      type: "NODE_UNDOCK_REF",
      panelId: panel.id,
      zone,
      refKey: nodeRefKey(ref),
    });
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
      {/* Title + description */}
      <div className="flex flex-col gap-1">
        <DebouncedInput
          value={panel.title}
          placeholder="Node title"
          ariaLabel="Node title"
          className="bg-transparent text-[15px] font-semibold text-text-primary placeholder:text-text-muted focus:outline-none"
          onCommit={(v) => patch({ title: v })}
        />
        <DebouncedTextarea
          value={panel.description}
          rows={2}
          placeholder="What happens at this step…"
          ariaLabel="Node description"
          onCommit={(v) => patch({ description: v })}
        />
      </div>

      <DockZone
        zone="read"
        panelId={panel.id}
        label="Read"
        hint="Drag in a knowledge base or file"
        refs={panel.reads}
        onUndock={(ref) => undock("read", ref)}
      />

      <DockZone
        zone="action"
        panelId={panel.id}
        label="Action"
        hint="Drag in a skill"
        refs={panel.actions}
        onUndock={(ref) => undock("action", ref)}
      />

      <LabeledArea
        label="User input"
        value={panel.userInput}
        placeholder="What the agent should ask or expect from the user…"
        onCommit={(v) => patch({ userInput: v })}
      />
      <LabeledArea
        label="Agent output"
        value={panel.agentOutput}
        placeholder="What the agent should produce at this step…"
        onCommit={(v) => patch({ agentOutput: v })}
      />
      <LabeledArea
        label="Next node"
        value={panel.nextInstructions}
        placeholder="When and how to move to the next node…"
        onCommit={(v) => patch({ nextInstructions: v })}
      />
    </div>
  );
}

// ── Dock zone ────────────────────────────────────────────────────────

function DockZone({
  zone,
  panelId,
  label,
  hint,
  refs,
  onUndock,
}: {
  zone: "read" | "action";
  panelId: string;
  label: string;
  hint: string;
  refs: NodeRef[];
  onUndock: (ref: NodeRef) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <div
        data-dock-zone={zone}
        data-dock-panel-id={panelId}
        className="min-h-[64px] rounded-lg border border-dashed border-border-default bg-surface-raised-1 p-1.5 flex flex-col gap-1 transition-colors data-[dock-active=true]:border-border-active data-[dock-active=true]:bg-surface-raised-3"
      >
        {refs.length === 0 ? (
          <span className="m-auto text-[11px] text-text-muted select-none pointer-events-none">
            {hint}
          </span>
        ) : (
          refs.map((ref) =>
            // Docked knowledge bases render their full panel body inline
            // (browse + read entries in place); files and skills stay
            // compact chips.
            ref.kind === "kb" ? (
              <EmbeddedKbRef
                key={nodeRefKey(ref)}
                nodeRef={ref}
                onUndock={onUndock}
              />
            ) : (
              <RefChip key={nodeRefKey(ref)} nodeRef={ref} onUndock={onUndock} />
            )
          )
        )}
      </div>
    </div>
  );
}

/**
 * A docked knowledge-base ref shown as the full KB panel body (embedded
 * mode: no attachment banner, no tree-expand button, no agent toggle) so
 * the node block displays the knowledge contents in place. The synthetic
 * panel object carries only what the body actually reads — the live
 * name/description/visibility come from its own useKnowledgeTree fetch.
 */
function EmbeddedKbRef({
  nodeRef,
  onUndock,
}: {
  nodeRef: Extract<NodeRef, { kind: "kb" }>;
  onUndock: (ref: NodeRef) => void;
}) {
  const embeddedPanel: KnowledgeBasePanelData = {
    id: `node-embed-${nodeRef.kbId}`,
    type: "knowledge-base",
    knowledgeBaseId: nodeRef.kbId,
    slug: "",
    name: nodeRef.name,
    description: null,
    agentWriteEnabled: false,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };
  return (
    <div
      data-no-drag
      className="relative h-[420px] overflow-hidden rounded-md border border-border-default bg-[var(--panel-surface)]"
    >
      <KnowledgeBasePanelBody panel={embeddedPanel} embedded />
      <button
        type="button"
        aria-label={`Remove ${nodeRef.name}`}
        title={`Remove ${nodeRef.name}`}
        onClick={() => onUndock(nodeRef)}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-2 top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-raised-3 hover:text-text-primary cursor-pointer"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function RefChip({
  nodeRef,
  onUndock,
}: {
  nodeRef: NodeRef;
  onUndock: (ref: NodeRef) => void;
}) {
  const Icon =
    nodeRef.kind === "skill"
      ? Sparkles
      : nodeRef.kind === "file"
        ? FileText
        : BookOpen;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-default bg-[var(--panel-surface)] px-2 py-1.5">
      <Icon size={12} className="shrink-0 text-text-secondary" />
      <span className="flex-1 min-w-0 truncate text-[12px] text-text-primary">
        {nodeRef.name}
      </span>
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-text-muted">
        {nodeRef.kind}
      </span>
      <button
        type="button"
        aria-label={`Remove ${nodeRef.name}`}
        onClick={() => onUndock(nodeRef)}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-raised-3 transition-colors cursor-pointer"
      >
        <X size={10} />
      </button>
    </div>
  );
}

// ── Text fields (commit on blur; local state while typing) ──────────

function DebouncedInput({
  value,
  placeholder,
  ariaLabel,
  className,
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  className: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      value={draft}
      data-no-drag
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function DebouncedTextarea({
  value,
  rows,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  rows: number;
  placeholder: string;
  ariaLabel: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <textarea
      value={draft}
      rows={rows}
      data-no-drag
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="resize-none bg-transparent text-[12px] leading-relaxed text-text-secondary placeholder:text-text-muted focus:outline-none"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}

function LabeledArea({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <textarea
        value={draft}
        rows={2}
        data-no-drag
        placeholder={placeholder}
        aria-label={label}
        className="rounded-lg border border-border-subtle bg-surface-raised-1 px-2.5 py-2 resize-none text-[12px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong transition-colors"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onCommit(draft);
        }}
      />
    </div>
  );
}
