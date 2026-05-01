"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { KnowledgeFolder } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Item being moved — used to disable invalid targets (self, descendants). */
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
 * Modal folder picker. Shows the base's folder tree as a single
 * selectable column. The "(Base root)" option is always at the top.
 *
 * For folder moves, the source folder + its descendants are disabled
 * to prevent the user from picking a target the server would reject
 * with a cycle error. (Server still validates as a safety net.)
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

  // Folders that would cause a cycle when moving a folder. Empty for
  // entries (any folder is valid).
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
      // Caller surfaces errors via toast; keep the dialog open so the
      // user can pick a different target rather than seeing a confusing
      // close-then-toast sequence.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move &ldquo;{itemLabel}&rdquo;</DialogTitle>
          <DialogDescription>
            Pick the folder to move this {itemType} into.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto rounded-md border border-white/[0.06] bg-white/[0.02]">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer",
              selected === null
                ? "bg-violet-500/[0.12] text-text-primary"
                : "text-text-secondary hover:bg-white/[0.04]"
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
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Moving…" : "Move here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                "w-full flex items-center gap-1.5 pr-3 py-1.5 text-xs",
                isBlocked
                  ? "text-text-secondary/30 cursor-not-allowed"
                  : selected === folder.id
                    ? "bg-violet-500/[0.12] text-text-primary cursor-pointer"
                    : "text-text-secondary hover:bg-white/[0.04] cursor-pointer"
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
                className="shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-white/[0.06]"
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
