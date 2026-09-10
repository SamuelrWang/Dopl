"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { pendingRow } from "@/shared/ui/pending";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { clusterObjectIds, type GraphState } from "../graph-state";

/**
 * THE CLUSTER PICKER, IN ITS TWO FACES (Samuel, 2026-09-10: the /home Ontology
 * face is the workspace board, *"and also, for the ontology switcher, instead of
 * different tabs, have it be a dropdown"*).
 *
 * ⚠ **ONE LIST SOURCE, TWO RENDERS — that is the whole point of the file.**
 * Both faces are fed by {@link clusterSwitcherEntries} over the board's own
 * `graph`, which is the `ontologySnapshotKey` cache entry `use-ontologies.ts`
 * reads for /home's rows. Two components each walking the graph their own way is
 * how the strip and the dropdown come to disagree about how many ontologies
 * there are.
 *
 * ⚠ **THE TWO FACES SAY DIFFERENT NUMBERS, DELIBERATELY.** The strip has always
 * carried a BARE number and it is the cluster's COLUMN count; the dropdown says
 * the words "N objects", which is the graph WALK (R5 — an object can sit in
 * several clusters). Rendering `columnCount` under the word "objects" is the one
 * mistake `use-ontologies.ts › ontologyListRows` already carries a warning
 * about, so the entry carries both numbers and neither face computes one.
 *
 * ⚠ **THE DROPDOWN OPENS IN COORDINATE MODE**, like `shared/ui/select-menu.tsx`
 * and for its reason: this control sits in the board header inside
 * `.page-float`, an overflow-clipping pane where a trigger-anchored panel
 * renders as a clipped sliver.
 */

export interface ClusterSwitcherEntry {
  id: string;
  name: string;
  /** The graph WALK (R5) — what the DROPDOWN says out loud. */
  objectCount: number;
  /** Columns in the cluster — the bare number the STRIP has always carried. */
  columnCount: number;
}

/** One graph → the entries both faces render. */
export function clusterSwitcherEntries(graph: GraphState): ClusterSwitcherEntry[] {
  return graph.clusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    objectCount: clusterObjectIds(graph, cluster.id).length,
    columnCount: cluster.columnIds.length,
  }));
}

export function ClusterSwitcher({
  mode,
  entries,
  activeId,
  pendingIds,
  canEdit,
  onSelect,
  onCreate,
}: {
  mode: "pills" | "dropdown";
  entries: readonly ClusterSwitcherEntry[];
  activeId: string;
  pendingIds: ReadonlySet<string>;
  /** Member+ — the strip's trailing create is hidden for a viewer. */
  canEdit?: boolean;
  onSelect: (id: string) => void;
  /** ⚠ THE STRIP'S trailing `+` ONLY. The dropdown's create is the HOST's — on
   *  /home it is the page's black "+ Ontology" button, which this tree cannot
   *  import (`apps/desktop-ui` is downstream of `src/`). */
  onCreate?: () => void;
}) {
  if (mode === "dropdown") {
    return (
      <ClusterDropdown entries={entries} activeId={activeId} onSelect={onSelect} />
    );
  }
  return (
    // Trackless stadium pills — SegmentedControl language (.seg-pill resting,
    // .raised-tab active); hand-composed for the trailing new-cluster button +
    // pending states.
    <div className="flex items-center gap-1.5">
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id)}
          {...pendingRow(
            pendingIds.has(entry.id),
            cn(
              "flex h-[27px] items-center gap-1.5 rounded-full px-3 text-caption font-medium transition-colors",
              entry.id === activeId
                ? "raised-tab text-text-primary"
                : "seg-pill text-text-secondary hover:text-text-primary"
            )
          )}
        >
          {entry.name}
          <span className="text-micro text-text-muted">{entry.columnCount}</span>
        </button>
      ))}
      {canEdit && onCreate && (
        <button
          type="button"
          onClick={onCreate}
          aria-label="New cluster"
          className="flex h-[27px] w-[27px] items-center justify-center rounded-full text-text-muted transition hover:text-text-primary"
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * ONE TRIGGER, EVERY ONTOLOGY BEHIND IT.
 *
 * ⚠ The trigger wears the ACTIVE PILL's face (`.raised-tab`, 27px, stadium), not
 * a new one: it stands in the slot the strip's selected pill stood in, and a
 * second dropdown vocabulary in the same header is the drift the kit exists to
 * stop.
 */
function ClusterDropdown({
  entries,
  activeId,
  onSelect,
}: {
  entries: readonly ClusterSwitcherEntry[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const active = entries.find((entry) => entry.id === activeId) ?? null;

  return (
    <div className="flex shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        title="Switch ontology"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          if (anchor) {
            setAnchor(null);
            return;
          }
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
        className="raised-tab flex h-[27px] max-w-[220px] items-center gap-1.5 rounded-full px-3 text-caption font-medium text-text-primary"
      >
        <span className="min-w-0 truncate">{active?.name}</span>
        <span className="shrink-0 text-micro text-text-muted">
          {active?.objectCount ?? 0}
        </span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="min-w-[220px] max-w-[320px]"
      >
        {entries.map((entry) => (
          <MenuItem
            key={entry.id}
            showCheck
            active={entry.id === activeId}
            description={`${entry.objectCount} ${
              entry.objectCount === 1 ? "object" : "objects"
            }`}
            onSelect={() => {
              setAnchor(null);
              if (entry.id !== activeId) onSelect(entry.id);
            }}
          >
            {entry.name}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
