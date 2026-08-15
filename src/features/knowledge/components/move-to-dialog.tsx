"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, X } from "lucide-react";
// ⚠ Deep import, not the `settings-modal` barrel: the barrel re-exports
// SettingsModal, which is Next-coupled (see base-settings-modal.tsx).
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";
import type { KnowledgeFolder } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Item being moved; disables invalid targets (self, descendants). */
  itemType: "folder" | "entry";
  itemId: string;
  /** Display label for the dialog header. */
  itemLabel: string;
  /** All folders in the base. */
  folders: KnowledgeFolder[];
  /** Called with the chosen target. `null` = base root. */
  onConfirm: (newParentId: string | null) => Promise<void>;
}

/**
 * Modal folder picker; "(Base root)" always at the top.
 *
 * For folder moves the source folder + descendants are disabled, so the user
 * cannot pick a target the server would reject as a cycle. Server still
 * validates.
 */
export function MoveToDialog({
  open,
  onOpenChange,
  itemType,
  itemId,
  itemLabel,
  folders,
  onConfirm,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);

  // Cycle-causing folders. Empty for entries: any folder is valid.
  const blockedIds = useMemo(() => {
    if (itemType !== "folder") return new Set<string>();
    const blocked = new Set<string>([itemId]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) {
        if (f.parentId && blocked.has(f.parentId) && !blocked.has(f.id)) {
          blocked.add(f.id);
          added = true;
        }
      }
    }
    return blocked;
  }, [folders, itemId, itemType]);

  const childFolders = useMemo(() => {
    const map = new Map<string | null, KnowledgeFolder[]>();
    for (const f of folders) {
      const arr = map.get(f.parentId) ?? [];
      arr.push(f);
      map.set(f.parentId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    }
    return map;
  }, [folders]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } catch {
      // Caller toasts errors; keep the dialog OPEN so the user can pick
      // another target instead of a close-then-toast sequence.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={() => onOpenChange(false)}
      label={`Move ${itemLabel}`}
      size="narrow"
    >
      <button
        type="button"
        className={modalStyles.close}
        onClick={() => onOpenChange(false)}
        aria-label="Close"
      >
        <X size={18} />
      </button>
      <div className={modalStyles.narrowBody}>
        <h2 className={modalStyles.narrowTitle}>Move &ldquo;{itemLabel}&rdquo;</h2>
        <p className="mb-6 text-lead leading-relaxed text-text-secondary">
          Pick the folder to move this {itemType} into.
        </p>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border-subtle bg-surface-raised-1">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-small cursor-pointer",
              selected === null
                ? "bg-surface-selected text-text-primary"
                : "text-text-secondary hover:bg-surface-raised-2"
            )}
          >
            <Folder size={12} className="text-text-secondary/70" />
            <span>Base root</span>
          </button>
          <FolderList
            depth={0}
            parentId={null}
            childFolders={childFolders}
            blocked={blockedIds}
            expanded={expanded}
            toggle={toggle}
            selected={selected}
            onSelect={setSelected}
          />
        </div>
        <div className={modalStyles.confirmActions}>
          <button
            type="button"
            className={modalStyles.btnCancel}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className={modalStyles.btnConfirm}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting ? "Moving…" : "Move here"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

interface ListProps {
  depth: number;
  parentId: string | null;
  childFolders: Map<string | null, KnowledgeFolder[]>;
  blocked: Set<string>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function FolderList({
  depth,
  parentId,
  childFolders,
  blocked,
  expanded,
  toggle,
  selected,
  onSelect,
}: ListProps) {
  const items = childFolders.get(parentId) ?? [];
  return (
    <>
      {items.map((folder) => {
        const isBlocked = blocked.has(folder.id);
        const isOpen = expanded.has(folder.id);
        const hasChildren = (childFolders.get(folder.id) ?? []).length > 0;
        return (
          <div key={folder.id}>
            <button
              type="button"
              onClick={() => !isBlocked && onSelect(folder.id)}
              disabled={isBlocked}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              className={cn(
                "w-full flex items-center gap-1.5 pr-3 py-1.5 text-small",
                isBlocked
                  ? "text-text-secondary/30 cursor-not-allowed"
                  : selected === folder.id
                    ? "bg-surface-selected text-text-primary cursor-pointer"
                    : "text-text-secondary hover:bg-surface-raised-2 cursor-pointer"
              )}
            >
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  if (!hasChildren) return;
                  e.stopPropagation();
                  toggle(folder.id);
                }}
                className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-surface-raised-3"
              >
                {hasChildren ? (
                  isOpen ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )
                ) : null}
              </span>
              {isOpen ? (
                <FolderOpen size={12} className="text-text-secondary/70 shrink-0" />
              ) : (
                <Folder size={12} className="text-text-secondary/70 shrink-0" />
              )}
              <span className="truncate">{folder.name}</span>
            </button>
            {isOpen ? (
              <FolderList
                depth={depth + 1}
                parentId={folder.id}
                childFolders={childFolders}
                blocked={blocked}
                expanded={expanded}
                toggle={toggle}
                selected={selected}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
