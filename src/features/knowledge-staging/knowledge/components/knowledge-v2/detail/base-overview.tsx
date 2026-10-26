"use client";

/** STAGING COPY of `src/features/knowledge/components/knowledge-v2/detail/base-overview.tsx` — redesigned ahead of its source (PORTING.md). */
import { MetaCard, type MetaTeamRef } from "./meta-card";
import { OverviewChangelog } from "./overview-changelog";
import { useBaseMetaEdit } from "./use-base-meta-edit";
import { longWhen } from "../utils";
import type { ViewModel } from "./view-model";
import type { KnowledgeBase } from "../../../types";
import styles from "../knowledge-v2.module.css";

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
 * is selected. One reading column — the name and description edited in place,
 * the Details card, then the Changelog, the base's day-grouped roll-up of every
 * revision of it and of everything in it.
 *
 * Changelog replaced "Contents" on 2026-09-09; the inline folder/entry
 * description editor it carried has no other home today. The loss is filed as
 * F-687 in `docs/REFACTOR-FINDINGS.md`; the unmounted Contents modules were
 * deleted under INVARIANTS §15 (cleanup K02, F-726) — read them from git history.
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
    <div className={styles.infoColumn}>
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
    </div>
  );
}
