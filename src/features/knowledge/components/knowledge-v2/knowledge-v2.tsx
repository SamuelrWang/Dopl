"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Role } from "@/features/workspaces/types";
import { BaseSettingsModal } from "../base-settings-modal";
import { MoveToDialog } from "../move-to-dialog";
import { ListPanel } from "./list/list-panel";
import { DetailPanel } from "./detail/detail-panel";
import { useKnowledgeV2Controller } from "./use-knowledge-v2-controller";
import type { BaseTree, KbTeamRef, Selection } from "./types";
import type { KnowledgeRouting, KnowledgeUrlSync } from "./routing";
import type { KnowledgeBase } from "../../types";
import styles from "./knowledge-v2.module.css";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  bases: KnowledgeBase[];
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** SSR-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  onCreate: () => void;
  /** Router bindings for the moves that leave this tree (./routing.ts). */
  routing: KnowledgeRouting;
  /** Selection ↔ address-bar adapter; defaults to the History API. */
  urlSync?: KnowledgeUrlSync;
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
  ownerNames,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
  onCreate,
  routing,
  urlSync,
}: Props) {
  const c = useKnowledgeV2Controller({
    workspaceId,
    workspaceSegment,
    initialBases: bases,
    initialSelection,
    initialTrees,
    urlSync,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsBase = c.selection?.base ?? null;

  return (
    <div className={cn("page-float", styles.shell)}>
      <ListPanel
        bases={c.visibleBases}
        ownerNames={ownerNames}
        currentUserId={currentUserId}
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
        canEditBase={settingsBase ? c.canEdit(settingsBase.id) : false}
        onTreeRefresh={c.refreshTree}
        onBaseSaved={() => {
          // The bases list is a live query now — refetch it so the local
          // user's own base rename/description edit reflects immediately;
          // refreshServerData() still repulls the owner/team pills, which
          // this tree renders but does not fetch.
          c.refetchBases();
          routing.refreshServerData();
        }}
        onSelectSearchEntry={c.selectEntryById}
        onCrumbSelect={c.selectCrumb}
        onExportBase={c.exportBase}
        onOpenSettings={() => setSettingsOpen(true)}
        routing={routing}
      />

      <ConfirmDialog
        open={c.deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) c.clearDeleteTarget();
        }}
        title={`Delete ${c.deleteTarget?.item.type === "folder" ? "folder" : "entry"}?`}
        description={
          c.deleteTarget
            ? c.deleteTarget.item.type === "folder"
              ? `This permanently deletes “${c.deleteTarget.item.label}” and everything inside it. This can't be undone.`
              : `This permanently deletes “${c.deleteTarget.item.label}”. This can't be undone.`
            : undefined
        }
        confirmLabel="Delete permanently"
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
          routing={routing}
        />
      ) : null}
    </div>
  );
}
