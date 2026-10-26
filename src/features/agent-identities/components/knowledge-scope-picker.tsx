"use client";

import { useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { SkeletonLine } from "@/shared/ui/skeleton";
import type { IdentityKnowledgeRef } from "../client/types";
import type { AttachableBasesState } from "../hooks/use-attachable-bases";
import { refKey, scopeChipLabel } from "../lib/knowledge-scopes";
import { RemovableChip } from "./identity-editor-rows";
import { BaseNode, type ScopeToggle } from "./knowledge-scope-tree";

/**
 * The knowledge picker: chips for what is attached over a checkable tree rendered in the form. A folder
 * means its subtree including later additions — its children render checked-and-locked, never expanded
 * into the set. It resolves no visibility of its own; the server 404s an unreadable scope.
 */

export interface KnowledgeBaseOption {
  id: string;
  name: string;
}

export function KnowledgeScopePicker({
  workspaceId,
  bases,
  selected,
  onChange,
  emptyLine,
  state = "ready",
  onRetry,
  renderSelected,
}: {
  workspaceId: string;
  /** The caller's own base read; this control never fetches the list. */
  bases: ReadonlyArray<KnowledgeBaseOption>;
  selected: ReadonlyArray<IdentityKnowledgeRef>;
  onChange: (next: IdentityKnowledgeRef[]) => void;
  /** Shown only when the base read has answered with nothing (`state` ready). */
  emptyLine: string;
  /** The base read's state (`hooks/use-attachable-bases.ts`); pending and failed are not empty. */
  state?: AttachableBasesState;
  onRetry?: () => void;
  /** Replaces the chip row — the /home card popup lists picks as bars. */
  renderSelected?: (selected: ReadonlyArray<IdentityKnowledgeRef>) => ReactNode;
}) {
  const treeRef = useRef<HTMLDivElement | null>(null);

  const selectedKeys = useMemo(
    () => new Set(selected.map(refKey)),
    [selected]
  );

  /** Add-or-remove plus a prune: checking an ancestor removes every scope it now implies. */
  const toggle: ScopeToggle = (ref, impliedKeys) => {
    const key = refKey(ref);
    if (selectedKeys.has(key)) {
      onChange(selected.filter((s) => refKey(s) !== key));
      return;
    }
    const pruned = new Set(impliedKeys);
    // A base covers all its scopes, pruned off the selection (the lazy tree is empty while collapsed).
    const covered = (s: IdentityKnowledgeRef) =>
      pruned.has(refKey(s)) || (ref.scope === "base" && s.baseId === ref.baseId);
    onChange([...selected.filter((s) => !covered(s)), ref]);
  };

  /** Arrow keys over the rendered rows, read from the DOM (the tree loads lazily); rows own Space/Enter. */
  function onTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const root = treeRef.current;
    if (!root) return;
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>('[role="treeitem"]')
    );
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "ArrowDown"
        ? Math.min(at + 1, rows.length - 1)
        : Math.max(at - 1, 0);
    rows[at === -1 ? 0 : next]?.focus();
    event.preventDefault();
  }

  return (
    <div className="flex flex-col gap-1.5">
      {renderSelected ? (
        renderSelected(selected)
      ) : selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((ref) => {
            const label = scopeChipLabel(ref);
            return (
              <RemovableChip
                key={refKey(ref)}
                label={label}
                detachLabel={`Detach ${label}`}
                onDetach={() =>
                  onChange(selected.filter((s) => refKey(s) !== refKey(ref)))
                }
              />
            );
          })}
        </div>
      )}
      {state === "pending" ? (
        <SkeletonLine w="60%" />
      ) : state === "failed" ? (
        <p role="alert" className="text-caption text-danger">
          Couldn&apos;t load knowledge.{" "}
          {onRetry && (
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </p>
      ) : bases.length === 0 ? (
        <span className="text-caption text-text-muted">{emptyLine}</span>
      ) : (
        // Inline (Samuel's ruling) and lazy: an unexpanded base reads nothing.
        <div
          ref={treeRef}
          role="tree"
          aria-label="Knowledge"
          onKeyDown={onTreeKeyDown}
          className="flex max-h-[220px] flex-col overflow-y-auto rounded-lg bg-bg-inset p-1"
        >
          {bases.map((base) => (
            <BaseNode
              key={base.id}
              base={base}
              workspaceId={workspaceId}
              selectedKeys={selectedKeys}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
