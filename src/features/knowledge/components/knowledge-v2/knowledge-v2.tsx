"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Role } from "@/features/workspaces/types";
import { BaseSettingsModal } from "../base-settings-modal";
import { MoveToDialog } from "../move-to-dialog";
import { ListPanel } from "./list/list-panel";
import { DetailPanel } from "./detail/detail-panel";
import { useKnowledgeV2Controller } from "./use-knowledge-v2-controller";
import type { BaseTree, KbTeamRef, Selection } from "./types";
import type { KnowledgeBase } from "../../types";
import styles from "./knowledge-v2.module.css";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  bases: KnowledgeBase[];
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** SSR-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  onCreate: () => void;
}

/**
 * Knowledge V2 root — the two-pane layout (list + detail) that fills the app
 * shell's content area. All state + URL sync + tree mutations live in the
 * controller hook; this component composes the panes and the root-mounted
 * delete/move dialogs. The far-left workspace rail + nav are the shell's.
 */
export function KnowledgeV2({
  workspaceId,
  workspaceSegment,
  bases,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
  onCreate,
}: Props) {
  const c = useKnowledgeV2Controller({
    workspaceId,
    workspaceSegment,
    bases,
    initialSelection,
    initialTrees,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBase = c.selection?.base ?? null;

  return (
    <div className={styles.shell}>
      <ListPanel
        bases={c.visibleBases}
        query={c.query}
        onQueryChange={c.setQuery}
        filter={c.filter}
        onFilterChange={c.setFilter}
        selectedBaseId={c.selectedBaseId}
        selectedEntryId={c.selectedEntryId}
        expanded={c.expanded}
        trees={c.trees}
        canEdit={c.canEdit}
        editingNodeId={c.editingNodeId}
        treeHandlers={c.treeHandlers}
        onSelectBase={c.handleSelectBase}
        onToggleExpand={c.handleToggleExpand}
        onSelectEntry={c.handleSelectEntry}
        onCreate={onCreate}
      />
      <DetailPanel
        selection={c.selection}
        workspaceId={workspaceId}
        selectedTree={settingsBase ? c.trees[settingsBase.id] : undefined}
        openEntry={c.openEntry}
        openEntryStatus={c.openEntryStatus}
        refetchOpenEntry={c.refetchOpenEntry}
        kbTeams={kbTeams}
        onTreeRefresh={c.refreshTree}
        onSelectSearchEntry={c.selectEntryById}
        onCrumbSelect={c.selectCrumb}
        onExportBase={c.exportBase}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={c.closeSelection}
      />

      <ConfirmDialog
        open={c.deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) c.clearDeleteTarget();
        }}
        title={`Delete ${c.deleteTarget?.item.type === "folder" ? "folder" : "entry"}?`}
        description={
          c.deleteTarget
            ? `“${c.deleteTarget.item.label}” will move to Trash. You can restore it until the trash is purged.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          await c.performDelete();
        }}
      />

      {c.moveTarget ? (
        <MoveToDialog
          open
          onOpenChange={(open) => {
            if (!open) c.clearMoveTarget();
          }}
          itemType={c.moveTarget.item.type}
          itemId={c.moveTarget.item.id}
          itemLabel={c.moveTarget.item.label}
          folders={c.trees[c.moveTarget.baseId]?.folders ?? []}
          onConfirm={c.handleConfirmMove}
        />
      ) : null}

      {settingsBase ? (
        <BaseSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSegment}
          base={settingsBase}
          currentUserId={currentUserId}
          role={role}
          folders={c.trees[settingsBase.id]?.folders ?? []}
          onFoldersChanged={() => c.refreshTree(settingsBase.id)}
        />
      ) : null}
    </div>
  );
}
