"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { Popover } from "@/shared/ui/popover-menu";
import type { WorkspacePickResource } from "../hooks/use-workflow-resources";
import type { ReadRefInput } from "../client/types";

interface Props {
  workspaceId: string;
  bases: WorkspacePickResource[];
  /** `name` is the display label for an optimistic chip before the refetch. */
  onPick: (ref: ReadRefInput, name: string) => void;
  /** Base ids already whole-attached — hidden from the top level. */
  excludeBaseIds?: string[];
  /** Entry ids already attached — hidden from a base's entry list. */
  excludeEntryIds?: string[];
  trigger: ReactNode;
  triggerClassName?: string;
}

/**
 * Read-ref picker with base → entry drill-in (adapted from ontology's
 * knowledge-pick-menu; features don't cross-import components — §3).
 * Clicking a base name attaches the whole base (`{ kbId }`); the chevron
 * expands it to list entries, and clicking an entry attaches that file
 * (`{ kbId, entryId }`).
 */
export function ReadPickMenu({
  workspaceId,
  bases,
  onPick,
  excludeBaseIds = [],
  excludeEntryIds = [],
  trigger,
  triggerClassName,
}: Props) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [openBase, setOpenBase] = useState<string | null>(null);

  const excludedBases = new Set(excludeBaseIds);
  const excludedEntries = new Set(excludeEntryIds);

  const close = () => {
    setAnchor(null);
    setOpenBase(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor((prev) => (prev ? null : { x: rect.left, y: rect.bottom + 4 }));
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={close}
        className="max-h-64 w-56 overflow-y-auto rounded-xl border-border-strong p-1"
      >
        {bases.length === 0 && (
          <p className="px-2 py-1.5 text-small text-text-muted">Nothing available to add</p>
        )}
        {bases.map((base) => (
          <BaseRow
            key={base.id}
            base={base}
            workspaceId={workspaceId}
            open={base.id === openBase}
            baseExcluded={excludedBases.has(base.id)}
            excludedEntryIds={excludedEntries}
            onToggle={() => setOpenBase((prev) => (prev === base.id ? null : base.id))}
            onPick={(ref, name) => {
              onPick(ref, name);
              close();
            }}
          />
        ))}
      </Popover>
    </>
  );
}

interface EntryItem {
  id: string;
  title: string;
}

function BaseRow({
  base,
  workspaceId,
  open,
  baseExcluded,
  excludedEntryIds,
  onToggle,
  onPick,
}: {
  base: WorkspacePickResource;
  workspaceId: string;
  open: boolean;
  baseExcluded: boolean;
  excludedEntryIds: Set<string>;
  onToggle: () => void;
  onPick: (ref: ReadRefInput, name: string) => void;
}) {
  const entriesQuery = useApiQuery(`/api/knowledge/bases/${base.id}/entries`, {
    workspaceId,
    enabled: open,
    select: (body: { entries: EntryItem[] }) =>
      body.entries.map((e) => ({ id: e.id, title: e.title })),
  });
  const entries = (entriesQuery.data ?? []).filter((e) => !excludedEntryIds.has(e.id));

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-center gap-1.5 rounded-lg pr-2 text-small font-semibold transition-colors",
          open ? "text-text-primary" : "text-text-secondary hover:bg-surface-raised-2"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Collapse ${base.name}` : `Expand ${base.name}`}
          className="flex items-center py-1.5 pl-2 text-text-muted"
        >
          <ChevronRight
            size={11}
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
          />
        </button>
        <button
          type="button"
          disabled={baseExcluded}
          onClick={() => onPick({ kbId: base.id }, base.name)}
          className={cn(
            "min-w-0 flex-1 truncate py-1.5 text-left transition-colors",
            baseExcluded ? "cursor-default text-text-muted" : "hover:text-text-primary"
          )}
        >
          {base.name}
        </button>
      </div>
      {open &&
        (entriesQuery.isLoading ? (
          <p className="py-1.5 pr-2 pl-6 text-body text-text-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="py-1.5 pr-2 pl-6 text-body text-text-muted">No entries</p>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() =>
                onPick({ kbId: base.id, entryId: entry.id }, `${base.name} / ${entry.title}`)
              }
              className="flex w-full items-center rounded-lg py-1.5 pr-2 pl-6 text-left text-body text-text-secondary transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
            >
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
            </button>
          ))
        ))}
    </div>
  );
}
