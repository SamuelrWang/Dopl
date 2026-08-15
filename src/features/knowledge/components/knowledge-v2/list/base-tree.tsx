"use client";

import type { KnowledgeBase, KnowledgeEntry } from "../../../types";
import type { BaseTree as BaseTreeData } from "../types";
import type { TreeHandlers } from "../use-knowledge-v2-trees";
import { TreeRows } from "./tree-rows";
import appShell from "@/shared/layout/app-shell/app-shell.module.css";

interface Props {
  base: KnowledgeBase;
  tree: BaseTreeData;
  selectedEntryId: string | null;
  canEdit: boolean;
  editingNodeId: string | null;
  handlers: TreeHandlers;
  onSelectEntry: (base: KnowledgeBase, entry: KnowledgeEntry) => void;
}

/**
 * Folder/file tree for one expanded base; binds the controller's per-base
 * mutation handlers. Rows read the v2 palette directly — the lightScope
 * wrapper only reaches the context menu + inline-rename input, which render
 * off semantic tokens.
 */
export function BaseTree({
  base,
  tree,
  selectedEntryId,
  canEdit,
  editingNodeId,
  handlers,
  onSelectEntry,
}: Props) {
  return (
    <div className={appShell.lightScope}>
      <TreeRows
        folders={tree.folders}
        entries={tree.entries}
        selectedEntryId={selectedEntryId}
        canEdit={canEdit}
        editingNodeId={editingNodeId}
        onSelect={(entryId) => {
          const entry = tree.entries.find((e) => e.id === entryId);
          if (entry) onSelectEntry(base, entry);
        }}
        onCreateFolder={(parentId, name) =>
          handlers.createFolder(base.id, parentId, name)
        }
        onCreateEntry={(folderId, title) =>
          handlers.createEntry(base.id, folderId, title)
        }
        onRename={handlers.handleRename}
        onRequestMove={(item) => handlers.handleRequestMove(base.id, item)}
        onDelete={(item) => handlers.handleDelete(base.id, item)}
        onDownload={handlers.handleDownload}
        onCommitRename={(item, name) =>
          handlers.handleCommitRename(base.id, item, name)
        }
        onCancelStub={(item) => handlers.handleCancelStub(base.id, item)}
        onClearEditing={handlers.handleClearEditing}
      />
    </div>
  );
}
