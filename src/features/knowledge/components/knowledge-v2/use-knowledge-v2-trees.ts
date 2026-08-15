"use client";

import { useCallback, useState } from "react";
import { toast } from "@/shared/ui/toast";
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import { meetsLevel } from "@/features/teams/access-levels";
import {
  createEntry as apiCreateEntry,
  createFolder as apiCreateFolder,
  deleteEntry as apiDeleteEntry,
  deleteFolder as apiDeleteFolder,
  downloadKnowledgeExport,
  moveEntry as apiMoveEntry,
  moveFolder as apiMoveFolder,
  updateEntry as apiUpdateEntry,
  updateFolder as apiUpdateFolder,
} from "../../client/api";
import type { KnowledgeBase } from "../../types";
import type { ContextMenuItem } from "../tree-context-menu";
import { reportError } from "./utils";
import type { Selection } from "./types";

/** Delete/move target plus its base (many trees can be open). */
interface ScopedItem {
  baseId: string;
  item: ContextMenuItem;
}

interface Args {
  workspaceId: string;
  bases: KnowledgeBase[];
  /** Refetch one base's tree (and reconcile the selection). */
  refreshTree: (baseId: string) => Promise<void>;
  setSelection: (selection: Selection) => void;
}

/**
 * Tree CRUD/move/delete/download handlers, keyed per `baseId` because many
 * trees stay open. Owns the inline-rename node and the delete/move dialog
 * targets. Split from the controller to hold both files under the 500-line cap.
 */
export function useKnowledgeV2Trees({
  workspaceId,
  bases,
  refreshTree,
  setSelection,
}: Args) {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScopedItem | null>(null);
  const [moveTarget, setMoveTarget] = useState<ScopedItem | null>(null);

  // ⚠ Falls OPEN while the access fetch is pending, so owners/admins never
  // see a flash of disabled affordances.
  const access = useMyAccessContext();
  const canEdit = useCallback(
    (baseId: string) => {
      const lvl = access.resolve("knowledge_base", baseId);
      return lvl == null ? true : meetsLevel(lvl, "edit");
    },
    [access]
  );

  const createFolder = useCallback(
    async (baseId: string, parentId: string | null, name: string) => {
      try {
        const folder = await apiCreateFolder(baseId, { parentId, name }, workspaceId);
        await refreshTree(baseId);
        // Into inline-rename; the tree marks it a stub so Escape removes the
        // empty placeholder.
        setEditingNodeId(folder.id);
        return folder.id;
      } catch (err) {
        reportError(err, "Couldn't create folder");
        throw err;
      }
    },
    [workspaceId, refreshTree]
  );

  const createEntry = useCallback(
    async (baseId: string, folderId: string | null, title: string) => {
      try {
        const entry = await apiCreateEntry(baseId, { folderId, title }, workspaceId);
        await refreshTree(baseId);
        const base = bases.find((b) => b.id === baseId);
        if (base) setSelection({ kind: "entry", base, entry });
        return entry.id;
      } catch (err) {
        reportError(err, "Couldn't create entry");
        throw err;
      }
    },
    [workspaceId, refreshTree, bases, setSelection]
  );

  // ⚠ Raw movers THROW on failure so the move dialog can stay open.
  const moveFolderRaw = useCallback(
    async (baseId: string, folderId: string, newParentId: string | null) => {
      await apiMoveFolder(folderId, { parentId: newParentId }, workspaceId);
      await refreshTree(baseId);
    },
    [workspaceId, refreshTree]
  );
  const moveEntryRaw = useCallback(
    async (baseId: string, entryId: string, newFolderId: string | null) => {
      await apiMoveEntry(entryId, { folderId: newFolderId }, workspaceId);
      await refreshTree(baseId);
    },
    [workspaceId, refreshTree]
  );

  const handleRename = useCallback((item: ContextMenuItem) => {
    setEditingNodeId(item.id);
  }, []);
  const handleClearEditing = useCallback(() => setEditingNodeId(null), []);
  const handleCommitRename = useCallback(
    async (baseId: string, item: ContextMenuItem, name: string) => {
      try {
        if (item.type === "folder") {
          await apiUpdateFolder(item.id, { name }, workspaceId);
        } else {
          await apiUpdateEntry(item.id, { title: name }, workspaceId);
        }
        await refreshTree(baseId);
      } catch (err) {
        reportError(err, "Couldn't rename");
        throw err;
      } finally {
        setEditingNodeId(null);
      }
    },
    [workspaceId, refreshTree]
  );
  const handleCancelStub = useCallback(
    async (baseId: string, item: ContextMenuItem) => {
      try {
        if (item.type === "folder") {
          await apiDeleteFolder(item.id, workspaceId);
        } else {
          await apiDeleteEntry(item.id, workspaceId);
        }
        await refreshTree(baseId);
        setEditingNodeId(null);
      } catch (err) {
        reportError(err, "Couldn't remove the unsaved row");
        setEditingNodeId(null);
        throw err;
      }
    },
    [workspaceId, refreshTree]
  );

  const handleDelete = useCallback((baseId: string, item: ContextMenuItem) => {
    setDeleteTarget({ baseId, item });
  }, []);
  const performDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const { baseId, item } = deleteTarget;
    try {
      if (item.type === "folder") {
        await apiDeleteFolder(item.id, workspaceId);
      } else {
        await apiDeleteEntry(item.id, workspaceId);
      }
      await refreshTree(baseId);
      toast({
        title: `${item.type === "folder" ? "Folder" : "Entry"} deleted`,
        description: item.label,
      });
    } catch (err) {
      reportError(err, "Couldn't delete");
    }
  }, [deleteTarget, workspaceId, refreshTree]);

  const handleRequestMove = useCallback(
    (baseId: string, item: ContextMenuItem) => {
      setMoveTarget({ baseId, item });
    },
    []
  );
  const handleConfirmMove = useCallback(
    async (newParentId: string | null) => {
      if (!moveTarget) return;
      const { baseId, item } = moveTarget;
      try {
        if (item.type === "folder") {
          await moveFolderRaw(baseId, item.id, newParentId);
        } else {
          await moveEntryRaw(baseId, item.id, newParentId);
        }
      } catch (err) {
        reportError(err, `Couldn't move ${item.type}`);
        throw err;
      }
    },
    [moveTarget, moveFolderRaw, moveEntryRaw]
  );

  const handleDownload = useCallback(
    async (item: ContextMenuItem) => {
      try {
        await downloadKnowledgeExport(item.type, item.id, workspaceId);
      } catch (err) {
        reportError(err, "Couldn't download");
      }
    },
    [workspaceId]
  );

  /** Export a whole base as a zip mirroring its tree. */
  const exportBase = useCallback(
    async (baseId: string) => {
      try {
        await downloadKnowledgeExport("base", baseId, workspaceId);
      } catch (err) {
        reportError(err, "Couldn't download knowledge base");
      }
    },
    [workspaceId]
  );

  return {
    canEdit,
    editingNodeId,
    treeHandlers: {
      createFolder,
      createEntry,
      handleRename,
      handleRequestMove,
      handleDelete,
      handleDownload,
      handleCommitRename,
      handleCancelStub,
      handleClearEditing,
    },
    deleteTarget,
    moveTarget,
    performDelete,
    handleConfirmMove,
    exportBase,
    clearDeleteTarget: () => setDeleteTarget(null),
    clearMoveTarget: () => setMoveTarget(null),
  };
}

/** Per-base tree handlers passed to base-tree.tsx → TreeRows. */
export type TreeHandlers = ReturnType<
  typeof useKnowledgeV2Trees
>["treeHandlers"];
