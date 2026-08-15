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
  /** Re-pull the SSR base list after a save so the list + toolbar stay in sync. */
  onSaved?: () => void;
  /** Teams granted on this base (admin view); undefined for members. */
  teams?: MetaTeamRef[];
  /** This base's stored bytes; `null` = unknown (no bar). */
  storageBytes?: number | null;
  /** The workspace's per-base cap in bytes; `null` = unknown (no bar). */
  storageLimit?: number | null;
  /** The selected base's tree — feeds the Contents section (no extra fetch). */
  tree?: BaseTree;
  /** Refresh the base's tree after a folder-description / entry-excerpt save. */
  onTreeRefresh: (baseId: string) => void;
}

/**
 * Base overview — the meta card shown when a whole knowledge base (not a
 * file) is selected. Name + description are editable and persist live; the
 * dates, visibility, access, and teams are read-only real values. Below it,
 * the Contents tree exposes each folder/entry's short description for inline
 * editing (the summaries agents read via MCP get_tree / list_dir).
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
