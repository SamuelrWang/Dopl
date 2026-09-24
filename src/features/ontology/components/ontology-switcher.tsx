"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { ontologyObjectIds, type GraphState } from "../graph-state";

/**
 * The ontology picker: the ontology's name is the trigger (2026-09-10). One face
 * for both boards — /home's pane and `/[ws]/ontology` — so there is no second
 * picker vocabulary in the same header.
 *
 * No pill, no border, no fill at rest: plain text in the channel list's own name
 * recipe (`relationship-list.tsx`: `text-body font-medium text-text-primary`) with
 * a chevron beside it. The ruling is explicit about the weight, so it lives here
 * rather than at a caller.
 *
 * The object count is in the menu rows, not the trigger, and it is the graph walk
 * (R5 — an object can sit in several ontologies), never `columnIds.length`. That is
 * the mistake `use-ontologies.ts › ontologyListRows` carries its own warning about.
 *
 * "+ Ontology" is the last row and a `MenuItem`, so the kit's hover face lands on
 * it like any other option.
 *
 * The dropdown opens in coordinate mode, like `shared/ui/select-menu.tsx` and for
 * its reason: inside `.page-float`, an overflow-clipping pane, a trigger-anchored
 * panel renders as a clipped sliver.
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
        className="flex max-w-[260px] items-center gap-1.5 bg-transparent text-body font-medium text-text-primary"
      >
        <span className="min-w-0 truncate">{active?.name || "Untitled"}</span>
        <ChevronDown size={13} className="shrink-0 text-text-muted" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={close}
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
