"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Role } from "@/features/workspaces/types";
import { BaseSettingsModal } from "../base-settings-modal";
import { MoveToDialog } from "../move-to-dialog";
import { ListPanel } from "./list/list-panel";
import { DetailPanel } from "./detail/detail-panel";
import { KnowledgeHome } from "./home/knowledge-home";
import { useKnowledgeV2Controller } from "./use-knowledge-v2-controller";
import type { BaseTree, KbTeamRef, Selection } from "./types";
import type { KnowledgeRouting, KnowledgeUrlSync } from "./routing";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../types";
import styles from "./knowledge-v2.module.css";

interface Props {
  workspaceId: string;
  workspaceSegment: string;
  bases: KnowledgeBase[];
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  /** Keyed by base id; home cards' meta line + storage bar. Same list
   *  response as `ownerNames`. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** Per-base storage cap in bytes, same response. Read by BOTH modes: home
   *  cards and the selected base's overview. */
  kbStorageLimit?: number | null;
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** SSR-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  onCreate: () => void;
  /** Bundled hero image for the home banner — injected by the host app. */
  heroImageSrc?: string;
  /** Router bindings for the moves that leave this tree (./routing.ts). */
  routing: KnowledgeRouting;
  /** Selection ↔ address-bar adapter; defaults to the History API. */
  urlSync?: KnowledgeUrlSync;
}

/**
 * Knowledge V2 root — TWO MODES over one controller, picked by the selection:
 *
 *   - no selection → HOME (`/knowledge`): card grid, mounts no trees.
 *   - a selection → BASE DETAIL (`/knowledge/{base}`): two-pane list+detail,
 *     list pane scoped to that ONE base's tree.
 *
 * ⚠ Selection is the mode because selection is what the URL encodes in both
 * directions (`use-knowledge-v2-controller` § URL ↔ selection sync). Reading
 * `useParams` here forks that agreement and puts the mode one render behind.
 *
 * State + URL sync + tree mutations live in the controller hook; this composes
 * the modes and the root-mounted delete/move dialogs.
 */
export function KnowledgeV2({
  workspaceId,
  workspaceSegment,
  bases,
  ownerNames,
  baseStats,
  kbStorageLimit,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
  onCreate,
  heroImageSrc,
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
  // Non-null below the home early-return; that is what makes the detail
  // branch's props total.
  const openBase = c.selection?.base ?? null;

  if (!openBase) {
    return (
      <div className={cn("page-float", styles.shell, styles.shellHome)}>
        <KnowledgeHome
          bases={c.visibleBases}
          filterCounts={c.filterCounts}
          baseStats={baseStats}
          kbStorageLimit={kbStorageLimit}
          ownerNames={ownerNames}
          // ⚠ Stars come from the CONTROLLER, not from a prop: per-user, and
          // riding the same live base-list query the controller already owns.
          // A host-page prop would only give the grid a second, staler copy.
          starredBaseIds={c.starredBaseIds}
          currentUserId={currentUserId}
          query={c.query}
          onQueryChange={c.setQuery}
          filter={c.filter}
          onFilterChange={c.setFilter}
          onOpenBase={c.handleSelectBase}
          onToggleStar={c.toggleStar}
          onCreate={onCreate}
          heroImageSrc={heroImageSrc}
        />

        {/* No base selected: base-scoped dialogs have nothing to act on. */}
      </div>
    );
  }

  return (
    <div className={cn("page-float", styles.shell)}>
      <ListPanel
        base={openBase}
        tree={c.trees[openBase.id]}
        selectedEntryId={c.selectedEntryId}
        canEdit={c.canEdit(openBase.id)}
        editingNodeId={c.editingNodeId}
        treeHandlers={c.treeHandlers}
        onSelectEntry={c.handleSelectEntry}
        // ⚠ A REAL navigation, not a local state flip: leaving a base is the
        // one move here that changes which route matches. Routing it through
        // `goToBase` keeps history honest (Back returns to the base) and lets
        // the URL→selection handler clear the selection, as it does on delete.
        onGoHome={() => routing.goToBase(null, "push")}
      />
      <DetailPanel
        selection={c.selection}
        workspaceId={workspaceId}
        selectedTree={c.trees[openBase.id]}
        openEntry={c.openEntry}
        openEntryStatus={c.openEntryStatus}
        refetchOpenEntry={c.refetchOpenEntry}
        kbTeams={kbTeams}
        baseStats={baseStats}
        kbStorageLimit={kbStorageLimit}
        canEditBase={c.canEdit(openBase.id)}
        onTreeRefresh={c.refreshTree}
        onBaseSaved={() => {
          // Refetch the live bases query so an own rename/description shows
          // immediately; refreshServerData() repulls the owner/team pills,
          // which this tree renders but does not fetch.
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

      {/* ⚠ Mounted for the whole detail mode, NOT gated on `settingsOpen`:
          ModalShell drives its enter transition off `open` changing after
          mount. */}
      <BaseSettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSegment}
        base={openBase}
        currentUserId={currentUserId}
        role={role}
        folders={c.trees[openBase.id]?.folders ?? []}
        onFoldersChanged={() => c.refreshTree(openBase.id)}
        routing={routing}
      />
    </div>
  );
}
