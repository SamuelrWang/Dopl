"use client";

import { MetaCard, type MetaTeamRef } from "./meta-card";
import { OverviewChangelog } from "./overview-changelog";
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
  /** Re-pull the base list after a save so list + toolbar stay in sync. */
  onSaved?: () => void;
  /** Teams granted on this base (admin view); undefined for members. */
  teams?: MetaTeamRef[];
  /** Stored bytes; `null` = unknown (no bar). */
  storageBytes?: number | null;
  /** Per-base cap in bytes; `null` = unknown (no bar). */
  storageLimit?: number | null;
}

/**
 * The info face: what the detail column rests on when a base rather than a file
 * is selected. Two flat sections on one ground — Details (name + description
 * persist live, the rest read-only) and Changelog, the base's day-grouped
 * roll-up of every revision of it and of everything in it.
 *
 * Changelog replaced "Contents" on 2026-09-09; the inline folder/entry
 * description editor it carried has no other home today, so the loss is filed in
 * `docs/REFACTOR-FINDINGS.md` and `overview-contents.tsx` /
 * `use-content-descriptions.ts` are left in the tree, unmounted, for it to point
 * at.
 *
 * No wrapper, on purpose: the stack's gap and padding belong to the scroll body
 * that hosts it (`../knowledge-v2.module.css › .infoBody`), so the sections are
 * siblings of the pane rather than children of a third box.
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
}: Props) {
  const { name, description, onNameChange, onDescriptionChange, flush } =
    useBaseMetaEdit(base, workspaceId, onSaved);

  return (
    <>
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
      <OverviewChangelog
        baseId={base.id}
        workspaceId={workspaceId}
        canEdit={canEdit}
      />
    </>
  );
}
