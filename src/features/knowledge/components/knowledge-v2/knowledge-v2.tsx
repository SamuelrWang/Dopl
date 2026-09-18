"use client";

import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { Role } from "@/features/workspaces/types";
import { BaseSettingsModal } from "../base-settings-modal";
import { MoveToDialog } from "../move-to-dialog";
import { ListPanel } from "./list/list-panel";
import { BaseHeader } from "./detail/base-header";
import { DetailPanel } from "./detail/detail-panel";
import { KnowledgeHome } from "./home/knowledge-home";
import { useKnowledgeV2Controller } from "./use-knowledge-v2-controller";
import type { BaseTree, KbTeamRef, Selection } from "./types";
import type { KnowledgeRouting, KnowledgeUrlSync } from "./routing";
import type { KbShelf, KnowledgeBase, KnowledgeBaseStats } from "../../types";
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
  /** Which shelf this view reads (`../../types.ts › KbShelf`); forwarded to the
   *  controller's list query and the star write that patches it. Undefined =
   *  unfiltered. */
  shelf?: KbShelf;
  /** Router bindings for the moves that leave this tree (./routing.ts). */
  routing: KnowledgeRouting;
  /** Selection ↔ address-bar adapter; defaults to the History API. */
  urlSync?: KnowledgeUrlSync;
  /**
   * This mount is already inside a panel — paint none (Samuel's ruling,
   * 2026-08-28: "kill the double panel").
   *
   * A structural fact, not a style, hence a prop rather than a scoped CSS
   * override: `.page-float` is THE full-page surface and the kit allows exactly
   * one per page (docs/DESIGN-SYSTEM.md › Patterns), so /home's Knowledge face
   * mounting this tree inside the record pane would be a panel on a panel.
   * Defaults false, so the workspace page is unchanged by construction.
   */
  embedded?: boolean;
}

/**
 * Knowledge V2 root — TWO MODES over one controller, picked by the selection:
 *
 *   - no selection → HOME (`/knowledge`): card grid, mounts no trees.
 *   - a selection → BASE DETAIL (`/knowledge/{base}`): ONE panel — a header
 *     across the top, a collapsible folder rail scoped to that base's tree, and
 *     a detail column that crossfades between the base's INFO face (the resting
 *     state) and an open file.
 *
 * Selection is the mode because selection is what the URL encodes in both
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
  shelf,
  routing,
  urlSync,
  embedded = false,
}: Props) {
  const c = useKnowledgeV2Controller({
    workspaceId,
    workspaceSegment,
    initialBases: bases,
    initialSelection,
    initialTrees,
    shelf,
    urlSync,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // the selection itself, not just its base: narrowing here makes the detail
  // branch's props total.
  const selection = c.selection;
  const openBase = selection?.base ?? null;

  if (!selection || !openBase) {
    return (
      <div className={cn(!embedded && "page-float", styles.shell, styles.shellHome)}>
        <KnowledgeHome
          bases={c.visibleBases}
          filterCounts={c.filterCounts}
          baseStats={baseStats}
          kbStorageLimit={kbStorageLimit}
          ownerNames={ownerNames}
          // stars come from the CONTROLLER, not a prop: same live base-list
          // query, so the grid cannot hold a second, staler copy.
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

        {/* no base selected: base-scoped dialogs have nothing to act on. */}
      </div>
    );
  }

  return (
    // one panel, three parts: a header spanning it, then the rail and the
    // detail column side by side beneath (Samuel's ruling, 2026-08-28) — a
    // panel with two headers reads as two panels.
    <div className={cn(!embedded && "page-float", styles.shell)}>
      <BaseHeader
        selection={selection}
        workspaceId={workspaceId}
        selectedTree={c.trees[openBase.id]}
        // a real navigation, not a local state flip: `goToBase` keeps history
        // honest (Back returns to the base) and lets the URL→selection handler
        // clear the selection, as it does on delete.
        onGoHome={() => routing.goToBase(null, "push")}
        // the base, not its first file: `selectCrumb(base, null)` would pick
        // `entries[0]`, but the info face is the resting state.
        onSelectBaseRoot={c.handleSelectBase}
        onSelectFolder={c.selectCrumb}
        onSelectSearchEntry={c.selectEntryById}
        onExportBase={c.exportBase}
        onOpenSettings={() => setSettingsOpen(true)}
        routing={routing}
      />

      <div className={styles.baseBody}>
        <ListPanel
          base={openBase}
          tree={c.trees[openBase.id]}
          selectedEntryId={c.selectedEntryId}
          canEdit={c.canEdit(openBase.id)}
          editingNodeId={c.editingNodeId}
          treeHandlers={c.treeHandlers}
          onSelectEntry={c.handleSelectEntry}
        />
        <DetailPanel
          selection={selection}
          workspaceId={workspaceId}
          openEntry={c.openEntry}
          openEntryStatus={c.openEntryStatus}
          refetchOpenEntry={c.refetchOpenEntry}
          kbTeams={kbTeams}
          baseStats={baseStats}
          kbStorageLimit={kbStorageLimit}
          canEditBase={c.canEdit(openBase.id)}
          onTreeRefresh={c.refreshTree}
          onBaseSaved={() => {
            // refetch the live bases query so a rename/description shows
            // immediately; refreshServerData() repulls the owner/team pills,
            // which this tree renders but does not fetch.
            c.refetchBases();
            routing.refreshServerData();
          }}
        />
      </div>

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

      {/* mounted for the whole detail mode, not gated on `settingsOpen`:
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
