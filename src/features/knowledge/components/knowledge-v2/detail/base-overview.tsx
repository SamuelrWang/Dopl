"use client";

import { MetaCard, type MetaTeamRef } from "./meta-card";
import { OverviewContents } from "./overview-contents";
import { useBaseMetaEdit } from "./use-base-meta-edit";
import { longWhen } from "../utils";
import type { ViewModel } from "./view-model";
import type { BaseTree } from "../types";
import type { KnowledgeBase } from "../../../types";

interface Props {
  base: KnowledgeBase;
  vm: ViewModel;
  workspaceId: string;
  /** Owners/editors can edit name + description; viewers are read-only. */
  canEdit: boolean;
  /** Re-pull the base list after a save so list + toolbar stay in sync. */
  onSaved?: () => void;
  /** Teams granted on this base (admin view); undefined for members. */
  teams?: MetaTeamRef[];
  /** Stored bytes; `null` = unknown (no bar). */
  storageBytes?: number | null;
  /** Per-base cap in bytes; `null` = unknown (no bar). */
  storageLimit?: number | null;
  /** Selected base's tree; feeds Contents with no extra fetch. */
  tree?: BaseTree;
  /** Refresh the base's tree after a folder-description / entry-excerpt save. */
  onTreeRefresh: (baseId: string) => void;
}

/**
 * Meta card shown when a whole base (not a file) is selected. Name +
 * description persist live; dates/visibility/access/teams are read-only.
 * Below, the Contents tree inline-edits each folder/entry description — the
 * summaries agents read via MCP get_tree / list_dir.
 */
export function BaseOverview({
  base,
  vm,
  workspaceId,
  canEdit,
  onSaved,
  teams,
  storageBytes,
  storageLimit,
  tree,
  onTreeRefresh,
}: Props) {
  const { name, description, onNameChange, onDescriptionChange, flush } =
    useBaseMetaEdit(base, workspaceId, onSaved);

  return (
    <div className="flex flex-col gap-5">
      <MetaCard
        name={name}
        description={description}
        canEdit={canEdit}
        onNameChange={onNameChange}
        onDescriptionChange={onDescriptionChange}
        onFlush={flush}
        createdAt={longWhen(vm.createdAt)}
        updatedAt={longWhen(vm.updatedAt)}
        scopeLabel={vm.scopeLabel}
        accessLabel={vm.accessLabel}
        teams={teams}
        storageBytes={storageBytes}
        storageLimit={storageLimit}
      />
      <OverviewContents
        tree={tree}
        baseId={base.id}
        workspaceId={workspaceId}
        canEdit={canEdit}
        onTreeRefresh={onTreeRefresh}
      />
    </div>
  );
}
