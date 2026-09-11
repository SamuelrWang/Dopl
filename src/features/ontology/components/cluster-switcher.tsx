"use client";

import { useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { clusterObjectIds, type GraphState } from "../graph-state";

/**
 * THE CLUSTER PICKER — **THE ONTOLOGY'S NAME IS THE TRIGGER** (Samuel,
 * 2026-09-10: *"remove the new cluster dropdown … the name of the ontology to
 * the right of that, make that a dropdown, but no pill, only a down arrow to its
 * right. Also unbold the text"*, and *"move the + ontology button, make it a
 * button/option in the ontology dropdown selector"*).
 *
 * ⚠ **ONE FACE, NOT TWO.** This file carried a `mode` of `"pills"` (a tab strip
 * with a trailing `+`) beside the dropdown until 2026-09-10; the strip is DELETED
 * and both boards — /home's pane and `/[ws]/ontology` — mount this one control.
 * A second picker vocabulary in the same header is the drift the kit exists to
 * stop, and the ruling above is for THE BOARD's header, not for one page's.
 *
 * ⚠ **NO PILL, NO BORDER, NO FILL AT REST.** The trigger is the cluster's name
 * as plain text in the channel list's own name recipe (`relationship-list.tsx`:
 * `text-body font-medium text-text-primary` — Samuel, 2026-09-10: *"match it to
 * the text and font size and styling of the name of the channel in the left
 * channel selector"*) with a chevron beside it. The
 * ruling is explicit about the weight, so it lives here rather than at a caller.
 *
 * ⚠ **THE OBJECT COUNT IS IN THE MENU, NOT THE TRIGGER** — the trigger says the
 * name and nothing else (the count was the pill's, and the pill is gone). The
 * rows still say the words "N objects", which is the graph WALK (R5 — an object
 * can sit in several clusters), never `columnIds.length`. That is the mistake
 * `use-ontologies.ts › ontologyListRows` carries its own warning about.
 *
 * ⚠ **"+ Ontology" IS THE LAST ROW OF THIS MENU** and it is a `MenuItem` — the
 * shared row, so the kit's hover face lands on it like any other option. It was
 * /home's black page button in the header until 2026-09-10 (Samuel: *"it
 * shouldn't be a black button it should be like a gray"*).
 *
 * ⚠ **THE DROPDOWN OPENS IN COORDINATE MODE**, like `shared/ui/select-menu.tsx`
 * and for its reason: this control sits in the board header inside
 * `.page-float`, an overflow-clipping pane where a trigger-anchored panel
 * renders as a clipped sliver.
 */

export interface ClusterSwitcherEntry {
  id: string;
  name: string;
  /** The graph WALK (R5) — what the menu rows say out loud. */
  objectCount: number;
}

/** One graph → the rows the menu renders. */
export function clusterSwitcherEntries(graph: GraphState): ClusterSwitcherEntry[] {
  return graph.clusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    objectCount: clusterObjectIds(graph, cluster.id).length,
  }));
}

export function ClusterSwitcher({
  entries,
  activeId,
  canEdit,
  onSelect,
  onCreate,
}: {
  entries: readonly ClusterSwitcherEntry[];
  activeId: string;
  /** Member+ — a viewer gets the list and no create row. */
  canEdit?: boolean;
  onSelect: (id: string) => void;
  /** ⚠ THE MENU'S LAST ROW. A host with its own create path passes ITS
   *  function (/home POSTs and selects the id the SERVER minted); the board
   *  passes its own optimistic one. Absent ⇒ no create row at all. */
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
