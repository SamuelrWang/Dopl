"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { BARE_TRIGGER_FACE } from "@/shared/ui/select-menu";
import { ontologyObjectIds, type GraphState } from "@/features/ontology/graph-state";

/**
 * The ontology picker: the ontology's name is the trigger, the `bare` select face at the header's
 * heading step. The object count is in the menu rows and is the graph walk (an object can sit in
 * several ontologies), never `columnIds.length`. "+ Ontology" is the last row.
 *
 * Coordinate mode: inside `.page-float` a trigger-anchored panel renders as a clipped sliver.
 */

export interface OntologySwitcherEntry {
  id: string;
  name: string;
  /** The graph walk (R5) — what the menu rows say out loud. */
  objectCount: number;
}

/** One graph → the rows the menu renders. */
export function ontologySwitcherEntries(graph: GraphState): OntologySwitcherEntry[] {
  return graph.ontologies.map((ontology) => ({
    id: ontology.id,
    name: ontology.name,
    objectCount: ontologyObjectIds(graph, ontology.id).length,
  }));
}

export function OntologySwitcher({
  entries,
  activeId,
  canEdit,
  onSelect,
  onCreate,
}: {
  entries: readonly OntologySwitcherEntry[];
  activeId: string;
  /** Member+ — a viewer gets the list and no create row. */
  canEdit?: boolean;
  onSelect: (id: string) => void;
  /** The menu's last row. A host with its own create path passes its function
   *  (/home POSTs and selects the id the server minted); the board passes its own
   *  optimistic one. Absent ⇒ no create row at all. */
  onCreate?: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const active = entries.find((entry) => entry.id === activeId) ?? null;
  const close = () => setAnchor(null);

  return (
    <div className="flex min-w-0 shrink-0 items-center">
      <button
        ref={triggerRef}
        type="button"
        title="Switch ontology"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => {
          if (anchor) {
            close();
            return;
          }
          const rect = triggerRef.current?.getBoundingClientRect();
          if (rect) setAnchor({ x: rect.left, y: rect.bottom + 6 });
        }}
        className={cn(BARE_TRIGGER_FACE, "flex h-9 max-w-[260px] items-center gap-1.5 text-heading")}
      >
        <span className="min-w-0 truncate">{active?.name || "Untitled"}</span>
        <ChevronDown size={13} className="shrink-0 text-text-muted" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={close}
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
              close();
              if (entry.id !== activeId) onSelect(entry.id);
            }}
          >
            {entry.name}
          </MenuItem>
        ))}
        {canEdit && onCreate && (
          <>
            <MenuDivider />
            <MenuItem
              icon={<Plus size={12} />}
              onSelect={() => {
                close();
                onCreate();
              }}
            >
              Ontology
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}
