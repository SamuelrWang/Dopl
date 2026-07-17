"use client";

import { MetaCard, type MetaTeamRef } from "./meta-card";
import { useBaseMetaEdit } from "./use-base-meta-edit";
import { longWhen } from "../utils";
import type { ViewModel } from "./view-model";
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
}

/**
 * Base overview — the meta card shown when a whole knowledge base (not a
 * file) is selected. Name + description are editable and persist live; the
 * dates, visibility, access, and teams are read-only real values.
 */
export function BaseOverview({ base, vm, workspaceId, canEdit, onSaved, teams }: Props) {
  const { name, description, onNameChange, onDescriptionChange, flush } =
    useBaseMetaEdit(base, workspaceId, onSaved);

  return (
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
    />
  );
}
