"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { EditableTitle } from "@/shared/layout/editable-title";
import { toast } from "@/shared/ui/toast";
import { VisibilityPill, MakePublicAction } from "@/shared/ui/visibility-pill";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/members/access-defaults";
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
import { useKnowledgeEntry } from "../client/hooks";
import { useKnowledgeRealtime } from "../client/realtime";
import { BaseSettingsModal } from "./base-settings-modal";
import { DocPane } from "./doc-pane";
import { KnowledgeSearch } from "./knowledge-search";
import { KnowledgeTree } from "./knowledge-tree";
import { MoveToDialog } from "./move-to-dialog";
import type { ContextMenuItem } from "./tree-context-menu";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  /** SSR-fetched body for the initially-selected entry. When provided,
   *  the entry hook seeds from this and skips the first network fetch. */
  initialEntry: KnowledgeEntry | null;
  /** True if the current user is the KB's owner — gates the inline
   *  "Make public" button next to the visibility pill. */
  isOwner: boolean;
}

export function KnowledgeBaseView({
  workspaceSlug,
  workspaceId,
  base,
  folders: initialFolders,
  entries: initialEntries,
  initialEntry,
  isOwner,
}: Props) {
  const [folders, setFolders] = useState(initialFolders);
  const [entries, setEntries] = useState(initialEntries);
  const [selectedId, setSelectedId] = useState<string>(
    initialEntries[0]?.id ?? ""
  );
  // Audit A-005 / A-013: gate write affordances (rename context menu,
  // "+ New folder/entry") on the caller's effective access. Falls open
  // to `true` while the access fetch is loading so admins/owners don't
  // see a flicker of disabled UI.
  const access = useMyAccessContext();
  const accessLevel = access.resolve("knowledge_base", base.id);
  const canEdit = accessLevel == null ? true : meetsLevel(accessLevel, "edit");
  // Inline-editable display name. Prop is the source of truth on
  // navigation / hard refresh; local state takes over after a rename
  // so the user sees their edit immediately without a route reload.
  const [displayedName, setDisplayedName] = useState(base.name);
  useEffect(() => {
    setDisplayedName(base.name);
  }, [base.name]);
  // Local mirror of base.visibility so the inline "Make public"
  // affordance updates the pill immediately without waiting for the
  // next page render. Stays in sync if the prop changes externally.
  const [displayedVisibility, setDisplayedVisibility] = useState(
    base.visibility,
  );
  useEffect(() => {
    setDisplayedVisibility(base.visibility);
  }, [base.visibility]);

  const selectedMeta = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? entries[0] ?? null,
    [entries, selectedId]
  );

  // Body comes from a per-entry fetch — tree omits bodies for size.
  // Expose `refetch` so the autosave path can recover from a 412.
  // `initialEntry` is the server-fetched body for the first-selected
  // entry; the hook seeds from it and skips the initial fetch so the
  // page paints with content on reload (no client-side waterfall).
  const { data: fullEntry, refetch: refetchEntry } = useKnowledgeEntry(
    selectedMeta?.id,
    workspaceId,
    initialEntry
      ? { initialData: initialEntry, initialEntryId: initialEntry.id }
      : undefined
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
  // INSERT/UPDATE/DELETE on this workspace's folders or entries refetches
  // the tree AND the open entry, so another user's saved edit appears
  // without waiting for a tab refocus. DocPane's re-seed effect applies
  // the fresh entry body ONLY when the editor is clean (not dirty/saving/
  // conflict), so this never clobbers an active typer.
  const onRealtimeChange = useCallback(() => {
    void refresh();
    void refetchEntry();
  }, [refresh, refetchEntry]);
  useKnowledgeRealtime(workspaceId, onRealtimeChange);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string): Promise<string> => {
      try {
        const folder = await apiCreateFolder(
          base.id,
          { parentId, name },
          workspaceId
        );
        await refresh();
        return folder.id;
      } catch (err) {
        reportError(err, "Couldn't create folder");
        throw err;
      }
    },
    [base.id, workspaceId, refresh]
  );

  const handleCreateEntry = useCallback(
    async (folderId: string | null, title: string): Promise<string> => {
      try {
        const entry = await apiCreateEntry(
          base.id,
          { folderId, title },
          workspaceId
        );
        await refresh();
        setSelectedId(entry.id);
        return entry.id;
      } catch (err) {
        reportError(err, "Couldn't create entry");
        throw err;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Id of the tree row currently in inline-rename mode. Set by:
   *   - handleRename (context-menu "Rename") for an existing row
   *   - tree's "+" / "New folder" affordance after a successful create
   * Cleared by KnowledgeTree once the inline editor commits or cancels.
   */
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);

  const handleRename = useCallback((item: ContextMenuItem) => {
    setEditingNodeId(item.id);
  }, []);

  const handleCommitRename = useCallback(
    async (item: ContextMenuItem, name: string) => {
      try {
        if (item.type === "folder") {
          await apiUpdateFolder(item.id, { name }, workspaceId);
        } else {
          await apiUpdateEntry(item.id, { title: name }, workspaceId);
        }
        await refresh();
      } catch (err) {
        reportError(err, "Couldn't rename");
        throw err;
      } finally {
        setEditingNodeId(null);
      }
    },
    [workspaceId, refresh]
  );

  const handleCancelStub = useCallback(
    async (item: ContextMenuItem) => {
      try {
        if (item.type === "folder") {
          await apiDeleteFolder(item.id, workspaceId);
        } else {
          await apiDeleteEntry(item.id, workspaceId);
        }
        await refresh();
        setEditingNodeId(null);
      } catch (err) {
        // Audit A-004: stub delete failures used to be silently
        // swallowed, leaving an "Untitled" row stuck in the tree
        // forever. Surface the failure so the user knows the cleanup
        // didn't land — they can rename or trash the row manually.
        reportError(err, "Couldn't remove the unsaved row");
        setEditingNodeId(null);
        throw err;
      }
    },
    [workspaceId, refresh]
  );

  const handleClearEditing = useCallback(() => {
    setEditingNodeId(null);
  }, []);

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
          <div className="flex items-center gap-2 min-w-0">
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
            <VisibilityPill visibility={displayedVisibility} />
            {displayedVisibility === "private" && isOwner ? (
              <MakePublicAction
                resourceType="knowledge base"
                onConfirm={async () => {
                  try {
                    await apiUpdateBase(
                      base.id,
                      { visibility: "public" },
                      workspaceId,
                    );
                    setDisplayedVisibility("public");
                    toast({ title: "Knowledge base is now public" });
                  } catch (err) {
                    reportError(err, "Couldn't publish");
                  }
                }}
              />
            ) : null}
          </div>
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
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
            >
              <Settings size={12} />
              Settings
            </button>
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
              canEdit={canEdit}
              onSelect={(id) => setSelectedId(id)}
              onCreateFolder={handleCreateFolder}
              onCreateEntry={handleCreateEntry}
              onMoveFolder={handleMoveFolder}
              onMoveEntry={handleMoveEntry}
              onRename={handleRename}
              onRequestMove={handleRequestMove}
              onDelete={handleDelete}
              editingNodeId={editingNodeId}
              onCommitRename={handleCommitRename}
              onCancelStub={handleCancelStub}
              onClearEditing={handleClearEditing}
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

      <BaseSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        base={base}
      />
    </>
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
