"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Plus, Settings, Trash2 } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { EditableTitle } from "@/shared/layout/editable-title";
import { toast } from "@/shared/ui/toast";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import {
  KnowledgeApiError,
  createEntry as apiCreateEntry,
  createFolder as apiCreateFolder,
  deleteEntry as apiDeleteEntry,
  deleteFolder as apiDeleteFolder,
  fetchTree,
  moveEntry as apiMoveEntry,
  moveFolder as apiMoveFolder,
  restoreEntry as apiRestoreEntry,
  restoreFolder as apiRestoreFolder,
  updateBase as apiUpdateBase,
  updateEntry as apiUpdateEntry,
  updateFolder as apiUpdateFolder,
} from "../client/api";
// `KnowledgeApiError` is still used by `reportError` below (rename /
// move / delete handlers); the autosave-side usage moved out with
// DocPane to ./doc-pane.tsx.
import { useKnowledgeEntry } from "../client/hooks";
import { useKnowledgeRealtime } from "../client/realtime";
import { DocPane } from "./doc-pane";
import { KnowledgeSearch } from "./knowledge-search";
import { KnowledgeTree } from "./knowledge-tree";
import { MoveToDialog } from "./move-to-dialog";
import { TrashModal } from "./trash-modal";
import type { ContextMenuItem } from "./tree-context-menu";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}

export function KnowledgeBaseView({
  workspaceSlug,
  workspaceId,
  base,
  folders: initialFolders,
  entries: initialEntries,
}: Props) {
  const [folders, setFolders] = useState(initialFolders);
  const [entries, setEntries] = useState(initialEntries);
  const [selectedId, setSelectedId] = useState<string>(
    initialEntries[0]?.id ?? ""
  );
  // Inline-editable display name. Prop is the source of truth on
  // navigation / hard refresh; local state takes over after a rename
  // so the user sees their edit immediately without a route reload.
  const [displayedName, setDisplayedName] = useState(base.name);
  useEffect(() => {
    setDisplayedName(base.name);
  }, [base.name]);

  const selectedMeta = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId]
  );

  // Body comes from a per-entry fetch — tree omits bodies for size.
  // Expose `refetch` so the autosave path can recover from a 412.
  const { data: fullEntry, refetch: refetchEntry } = useKnowledgeEntry(
    selectedMeta?.id,
    workspaceId
  );
  const displayEntry = fullEntry ?? selectedMeta;

  const refresh = useCallback(async () => {
    try {
      const tree = await fetchTree(base.id, workspaceId);
      setFolders(tree.folders);
      setEntries(tree.entries);
    } catch (err) {
      reportError(err, "Failed to refresh knowledge base");
    }
  }, [base.id, workspaceId]);

  // Live updates from MCP/CLI agents and other tabs (Item 5.E). Any
  // INSERT/UPDATE/DELETE on this workspace's folders or entries
  // triggers a tree refetch. Cheap — refetch is one HTTP round-trip.
  useKnowledgeRealtime(workspaceId, refresh);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string) => {
      try {
        await apiCreateFolder(base.id, { parentId, name }, workspaceId);
        await refresh();
      } catch (err) {
        reportError(err, "Couldn't create folder");
      }
    },
    [base.id, workspaceId, refresh]
  );

  const handleCreateEntry = useCallback(
    async (folderId: string | null, title: string) => {
      try {
        const entry = await apiCreateEntry(
          base.id,
          { folderId, title },
          workspaceId
        );
        await refresh();
        setSelectedId(entry.id);
      } catch (err) {
        reportError(err, "Couldn't create entry");
      }
    },
    [base.id, workspaceId, refresh]
  );

  // Internal raw movers that throw on failure. Wrapped versions for
  // drag-drop catch + toast; the dialog flow uses these directly so it
  // can keep the modal open on error.
  const moveFolderRaw = useCallback(
    async (folderId: string, newParentId: string | null) => {
      await apiMoveFolder(folderId, { parentId: newParentId }, workspaceId);
      await refresh();
    },
    [workspaceId, refresh]
  );

  const moveEntryRaw = useCallback(
    async (entryId: string, newFolderId: string | null) => {
      await apiMoveEntry(entryId, { folderId: newFolderId }, workspaceId);
      await refresh();
    },
    [workspaceId, refresh]
  );

  const handleMoveFolder = useCallback(
    async (folderId: string, newParentId: string | null) => {
      try {
        await moveFolderRaw(folderId, newParentId);
      } catch (err) {
        reportError(err, "Couldn't move folder");
      }
    },
    [moveFolderRaw]
  );

  const handleMoveEntry = useCallback(
    async (entryId: string, newFolderId: string | null) => {
      try {
        await moveEntryRaw(entryId, newFolderId);
      } catch (err) {
        reportError(err, "Couldn't move entry");
      }
    },
    [moveEntryRaw]
  );

  // ── Context-menu actions ─────────────────────────────────────────

  const [moveTarget, setMoveTarget] = useState<ContextMenuItem | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const handleRename = useCallback(
    async (item: ContextMenuItem) => {
      const next = window.prompt(
        item.type === "folder" ? "Folder name" : "Entry title",
        item.label
      );
      if (!next || !next.trim() || next.trim() === item.label) return;
      const name = next.trim();
      try {
        if (item.type === "folder") {
          await apiUpdateFolder(item.id, { name }, workspaceId);
        } else {
          await apiUpdateEntry(item.id, { title: name }, workspaceId);
        }
        await refresh();
      } catch (err) {
        reportError(err, "Couldn't rename");
      }
    },
    [workspaceId, refresh]
  );

  const handleDelete = useCallback(
    async (item: ContextMenuItem) => {
      const ok = window.confirm(
        `Delete ${item.type} “${item.label}”? You can restore it from Trash.`
      );
      if (!ok) return;
      try {
        if (item.type === "folder") {
          await apiDeleteFolder(item.id, workspaceId);
        } else {
          await apiDeleteEntry(item.id, workspaceId);
        }
        await refresh();
        toast({
          title: `${item.type === "folder" ? "Folder" : "Entry"} deleted`,
          description: item.label,
          action: {
            label: "Undo",
            onClick: async () => {
              try {
                if (item.type === "folder") {
                  await apiRestoreFolder(item.id, workspaceId);
                } else {
                  await apiRestoreEntry(item.id, workspaceId);
                }
                await refresh();
              } catch (err) {
                reportError(err, "Couldn't undo");
              }
            },
          },
        });
      } catch (err) {
        reportError(err, "Couldn't delete");
      }
    },
    [workspaceId, refresh]
  );

  const handleRequestMove = useCallback((item: ContextMenuItem) => {
    setMoveTarget(item);
  }, []);

  const handleConfirmMove = useCallback(
    async (newParentId: string | null) => {
      if (!moveTarget) return;
      // Use the raw movers so errors propagate to the dialog, which
      // keeps itself open on failure. Toast on error happens here so
      // the user sees the message even though the dialog stays open.
      try {
        if (moveTarget.type === "folder") {
          await moveFolderRaw(moveTarget.id, newParentId);
        } else {
          await moveEntryRaw(moveTarget.id, newParentId);
        }
      } catch (err) {
        reportError(err, `Couldn't move ${moveTarget.type}`);
        throw err;
      }
    },
    [moveTarget, moveFolderRaw, moveEntryRaw]
  );

  return (
    <>
      <PageTopBar
        title={
          <EditableTitle
            value={displayedName}
            onSave={async (next) => {
              const updated = await apiUpdateBase(
                base.id,
                { name: next },
                workspaceId
              );
              setDisplayedName(updated.name);
            }}
            onError={(err) => reportError(err, "Couldn't rename")}
            placeholder="Untitled knowledge base"
          />
        }
        trailing={
          <>
            <div className="w-56 hidden md:block">
              <KnowledgeSearch
                workspaceId={workspaceId}
                baseSlug={base.slug}
                onSelectEntry={(entryId) => setSelectedId(entryId)}
              />
            </div>
            <button
              type="button"
              onClick={async () => {
                const title = window.prompt("Entry title");
                if (title?.trim()) await handleCreateEntry(null, title.trim());
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
            >
              <Plus size={12} />
              Add entry
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label="More"
                onClick={() => setHeaderMenuOpen((v) => !v)}
                className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <MoreHorizontal size={13} className="text-text-secondary" />
              </button>
              {headerMenuOpen ? (
                <HeaderMenu
                  workspaceSlug={workspaceSlug}
                  baseSlug={base.slug}
                  onOpenTrash={() => {
                    setHeaderMenuOpen(false);
                    setTrashOpen(true);
                  }}
                  onClose={() => setHeaderMenuOpen(false)}
                />
              ) : null}
            </div>
          </>
        }
      />
      <div
        className="pt-[52px] pointer-events-auto"
        style={{ backgroundColor: "oklch(0.13 0 0)" }}
      >
        <div className="flex h-[calc(100vh-52px)]">
          <aside
            className="hidden md:flex w-72 shrink-0 flex-col border-r border-white/[0.06]"
            style={{ backgroundColor: "oklch(0.135 0 0)" }}
          >
            <KnowledgeTree
              baseId={base.id}
              folders={folders}
              entries={entries}
              selectedEntryId={displayEntry?.id ?? null}
              onSelect={(id) => setSelectedId(id)}
              onCreateFolder={handleCreateFolder}
              onCreateEntry={handleCreateEntry}
              onMoveFolder={handleMoveFolder}
              onMoveEntry={handleMoveEntry}
              onRename={handleRename}
              onRequestMove={handleRequestMove}
              onDelete={handleDelete}
            />
          </aside>
          <div
            className="flex-1 min-w-0 overflow-y-auto"
            style={{ backgroundColor: "oklch(0.11 0 0)" }}
          >
            {displayEntry ? (
              <DocPane
                key={displayEntry.id}
                entry={displayEntry}
                workspaceId={workspaceId}
                onSaved={refresh}
                onStaleVersion={() => {
                  // DocPane now owns 412 recovery — it fetches the
                  // server's current state into a local conflict
                  // banner so the user's unsaved edits in the editor
                  // can never be silently overwritten. We only refresh
                  // the surrounding tree here so the metadata
                  // (titles, timestamps) reflects the latest.
                  refresh();
                }}
                onFocusRefetch={() => {
                  // Tab regained focus and the editor isn't dirty —
                  // pull the latest tree + entry body so the user sees
                  // changes another tab/agent saved while away.
                  refetchEntry();
                  refresh();
                }}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </div>

      {moveTarget ? (
        <MoveToDialog
          open={moveTarget !== null}
          onOpenChange={(open) => {
            if (!open) setMoveTarget(null);
          }}
          itemType={moveTarget.type}
          itemId={moveTarget.id}
          itemLabel={moveTarget.label}
          folders={folders}
          onConfirm={handleConfirmMove}
        />
      ) : null}

      <TrashModal
        open={trashOpen}
        onOpenChange={setTrashOpen}
        workspaceId={workspaceId}
        baseId={base.id}
        onRestored={refresh}
      />
    </>
  );
}

// ── Header more-menu ────────────────────────────────────────────────

function HeaderMenu({
  workspaceSlug,
  baseSlug,
  onOpenTrash,
  onClose,
}: {
  workspaceSlug: string;
  baseSlug: string;
  onOpenTrash: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md border border-white/[0.1] bg-[oklch(0.16_0_0)] shadow-2xl shadow-black/60 py-1 z-50"
    >
      <Link
        href={`/${workspaceSlug}/knowledge/${baseSlug}/settings`}
        onClick={onClose}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.04] hover:text-text-primary cursor-pointer"
      >
        <Settings size={12} />
        Settings
      </Link>
      <button
        type="button"
        onClick={onOpenTrash}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:bg-white/[0.04] hover:text-text-primary cursor-pointer"
      >
        <Trash2 size={12} />
        Trash
      </button>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-text-secondary/60">
        No entries yet. Click &ldquo;Add entry&rdquo; to create one.
      </p>
    </div>
  );
}

// ── Error helper ────────────────────────────────────────────────────

function reportError(err: unknown, fallback: string): void {
  if (err instanceof KnowledgeApiError) {
    toast({ title: fallback, description: err.message });
    return;
  }
  toast({
    title: fallback,
    description: err instanceof Error ? err.message : "Unknown error",
  });
}
