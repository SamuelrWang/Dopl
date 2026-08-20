"use client";

import { useMemo, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { OntologySnapshot } from "@/features/ontology/types";
import { cn } from "@/shared/lib/utils";
import { usePlaygroundPoll, usePlaygroundSession } from "../../session";
import {
  DEMO_CLUSTERS,
  snapshotToClusters,
  type PaneCard,
  type PaneLane,
} from "./ontology-pane-data";

/**
 * Playground ONTOLOGY page — a visual clone of
 * `apps/desktop-ui/src/pages/ontology` (which renders
 * `features/ontology/components/ontology-view` + `kanban-board`). Same
 * page-float frame, same header row (cluster pills, name + purpose, column
 * controls), same `.graph-substrate kanban-substrate` dotted board with
 * `.kanban-card` column headers and object cards on the 12px grid (p-6 = 2
 * tiles, w-72 lanes = 24, gap-3 gutter = 1, lane p-3 = 1, card h-[216px] = 18).
 *
 * TWO content sources, one JSX (shapes in `./ontology-pane-data`):
 * - No session (or first poll unanswered): the static marketing demo,
 *   `DEMO_CLUSTERS`. Pills are cosmetic — no cluster switching.
 * - Live session: `usePlaygroundPoll` GETs `/api/ontology` (the full
 *   `OntologySnapshot` the real board reads) with the guest bearer +
 *   `X-Workspace-Id`; clusters become pills/lanes, objects become cards, and
 *   the pills actually switch clusters. Reads only — the writer is the
 *   visitor's agent over MCP.
 *
 * Local state is the active cluster (live only) plus cosmetic card selection
 * (the `.kanban-card` `data-selected` ring) and the column-header disclosure.
 */
export function OntologyPane() {
  const { session } = usePlaygroundSession();
  const { data } = usePlaygroundPoll<OntologySnapshot>(
    session ? "/api/ontology" : null
  );
  const live = useMemo(() => (data ? snapshotToClusters(data) : null), [data]);
  const clusters = live ?? DEMO_CLUSTERS;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  // Demo mode pins the first (populated) cluster, matching the old static
  // render; live mode follows the picked pill, falling back to the first
  // cluster when the picked one vanished mid-poll (agent deleted it).
  const active =
    (live ? clusters.find((c) => c.id === activeClusterId) : undefined) ??
    clusters[0] ??
    null;

  const selectCluster = live
    ? (id: string) => {
        setActiveClusterId(id);
        setSelectedId(null);
      }
    : undefined;

  if (!active) {
    // Live workspace with zero clusters (agent deleted them all).
    return (
      <div className="page-float flex flex-col antialiased">
        <p className="m-auto text-lead text-text-secondary">
          No ontology yet — ask your agent to create the first cluster.
        </p>
      </div>
    );
  }

  return (
    <div className="page-float flex flex-col antialiased">
      {/* Header row — cluster pills, cluster name + purpose, column controls. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5">
          {clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={selectCluster ? () => selectCluster(c.id) : undefined}
              className={cn(
                "flex h-[27px] items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-colors",
                c.id === active.id
                  ? "raised-tab text-text-primary"
                  : "seg-pill text-text-secondary hover:text-text-primary"
              )}
            >
              {c.name}
              <span className="text-micro text-text-muted">{c.count}</span>
            </button>
          ))}
          <button
            type="button"
            aria-label="New cluster"
            className="flex h-[27px] w-[27px] items-center justify-center rounded-full text-text-muted transition hover:text-text-primary"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="w-40 shrink-0 truncate text-title font-semibold tracking-tight text-text-primary">
            {active.name}
          </span>
          <span className="min-w-0 flex-1 truncate text-body text-text-secondary">
            {active.purpose}
          </span>
        </div>
        <button
          type="button"
          aria-label="Delete cluster"
          title="Delete cluster"
          className="btn-light flex h-7 w-8 shrink-0 items-center justify-center rounded-md text-text-primary"
        >
          <Trash2 size={11} />
        </button>
        <button
          type="button"
          className="btn-light flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-small font-medium text-text-primary"
        >
          <Plus size={12} /> Column
        </button>
      </div>

      {/* Board — dot grid is load-bearing geometry, every dimension is a whole
          number of 12px tiles (see features/ontology/components/kanban-board). */}
      <div className="graph-substrate kanban-substrate flex min-h-0 flex-1 items-start gap-3 overflow-auto p-6">
        {active.lanes.map((lane) => (
          <PaneLaneColumn
            key={lane.id}
            lane={lane}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ))}
      </div>
    </div>
  );
}

function PaneLaneColumn({
  lane,
  selectedId,
  onSelect,
}: {
  lane: PaneLane;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-2 self-start rounded-[14px] bg-bg-inset p-3">
      <PaneColumnHeader lane={lane} selected={selectedId === lane.id} onSelect={onSelect} />
      <div className="flex flex-col gap-2">
        {lane.cards.map((card) => (
          <PaneObjectCard
            key={card.id}
            card={card}
            selected={selectedId === card.id}
            onSelect={onSelect}
          />
        ))}
        <button
          type="button"
          className="btn-light flex shrink-0 items-center gap-1 self-start rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
        >
          <Plus size={12} /> {lane.name}
        </button>
      </div>
    </div>
  );
}

/** Column-header card: name row + collapsible template preview (cosmetic). */
function PaneColumnHeader({
  lane,
  selected,
  onSelect,
}: {
  lane: PaneLane;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = `playground-column-details-${lane.id}`;

  return (
    <div
      className="kanban-card shrink-0 rounded-[10px] border bg-bg-elevated"
      data-selected={selected ? "true" : undefined}
    >
      <div className="flex items-center gap-1 px-1.5 py-1" onClick={() => setOpen((v) => !v)}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          aria-label={`${open ? "Hide" : "Show"} details for ${lane.name}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
        >
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(lane.id);
          }}
          className="min-w-0 flex-1 truncate text-left text-body font-semibold tracking-tight text-text-primary"
        >
          {lane.name}
        </button>
        <span className="shrink-0 rounded-full bg-surface-raised-4 px-1.5 py-px text-micro font-medium text-text-secondary">
          {lane.cards.length}
        </span>
        <button
          type="button"
          aria-label={`Add object to ${lane.name}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          aria-label={`Column actions for ${lane.name}`}
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md p-1 text-text-muted transition hover:bg-surface-raised-3 hover:text-text-primary"
        >
          <MoreHorizontal size={13} />
        </button>
      </div>

      <div
        id={detailsId}
        inert={!open}
        className={cn(
          "grid transition-[grid-template-rows] duration-[250ms] ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border-subtle px-2 pt-1.5 pb-2">
            <p className="text-caption text-text-secondary">{lane.subtitle}</p>
            <p className="mt-2 text-label font-semibold uppercase tracking-wide text-text-muted">
              Default fields
            </p>
            {lane.fields.length === 0 ? (
              <p className="mt-1 text-caption text-text-muted">No template fields yet</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {lane.fields.map((field, i) => (
                  <li key={`${field.label}-${i}`} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-caption text-text-secondary">
                      {field.label}
                    </span>
                    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary">
                      {field.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Object card — fixed h-[216px] (18 dot tiles) like the real board's cards. */
function PaneObjectCard({
  card,
  selected,
  onSelect,
}: {
  card: PaneCard;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(card.id)}
      data-selected={selected ? "true" : undefined}
      className="kanban-card flex h-[216px] shrink-0 flex-col rounded-[10px] border bg-bg-elevated"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(card.id);
        }}
        className="flex min-h-0 w-full flex-1 flex-col items-start px-3 pt-3 pb-2 text-left"
      >
        <span className="block w-full truncate text-body font-semibold tracking-tight text-text-primary">
          {card.name}
        </span>
        <span className="mt-0.5 line-clamp-4 w-full text-caption text-text-secondary">
          {card.subtitle}
        </span>
        <span className="mt-auto flex w-full flex-wrap gap-1 pt-2">
          {card.chips.map((chip, i) => (
            <span
              key={`${chip}-${i}`}
              className="rounded-full border border-border-strong bg-bg-inset px-1.5 py-px text-micro font-medium text-text-secondary"
            >
              {chip}
            </span>
          ))}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1.5 border-t border-border-subtle px-3 py-2 text-micro text-text-muted">
        <span>{card.attrs} attrs</span>
        <span aria-hidden>·</span>
        <span>{card.edges} edges</span>
        <span aria-hidden>·</span>
        <span>{card.actions} actions</span>
      </div>
    </div>
  );
}
