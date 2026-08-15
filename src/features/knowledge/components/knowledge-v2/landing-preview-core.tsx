"use client";

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase, KnowledgeBaseStats } from "../../types";
import { CreateBaseDialog } from "../create-base-dialog";
import { KnowledgeV2 } from "./knowledge-v2";
import type { KnowledgeRouting, KnowledgeUrlSync } from "./routing";
import type { BaseTree, KbTeamRef, Selection } from "./types";

export interface KnowledgeV2PreviewCoreProps {
  workspaceSegment: string;
  workspaceId: string;
  bases: KnowledgeBase[];
  /** Display names for foreign base owners, keyed by user id. */
  ownerNames?: Record<string, string>;
  /** `{entryCount, lastEntryUpdatedAt, storageBytes}` keyed by base id — the
   *  home grid's card meta line + storage bar. Same list response as
   *  `ownerNames`. */
  baseStats?: Record<string, KnowledgeBaseStats>;
  /** The workspace's per-base storage cap in bytes, same response. */
  kbStorageLimit?: number | null;
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Pre-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** Pre-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  /** Bundled hero image for the home banner — injected by the host app. */
  heroImageSrc?: string;
  /** The two router-shaped dependencies, injected (./routing.ts). */
  routing: KnowledgeRouting;
  urlSync?: KnowledgeUrlSync;
}

/**
 * Knowledge V2 entry point. Mounts the two-mode view (home card grid /
 * base detail) plus the shared create-base dialog, which the home grid's
 * trailing "+ New knowledge base" cell opens. The surrounding app shell is
 * mounted by the host app's layout.
 *
 * ⚠ THE FILE NAME IS A FOSSIL, not a description: the web app's
 * `./landing-preview.tsx` wrapper (and every `/knowledge` RSC behind it) was
 * deleted with the website, so this "-core" half is now the ONE knowledge
 * entry point and its only caller is the desktop SPA
 * (apps/desktop-ui/src/pages/knowledge/index.tsx). Still Next-free by
 * construction — `routing`/`urlSync` are injected (./routing.ts).
 */
export function KnowledgeV2PreviewCore({
  workspaceSegment,
  workspaceId,
  bases,
  ownerNames,
  baseStats,
  kbStorageLimit,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
  heroImageSrc,
  routing,
  urlSync,
}: KnowledgeV2PreviewCoreProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <KnowledgeV2
        workspaceId={workspaceId}
        workspaceSegment={workspaceSegment}
        bases={bases}
        ownerNames={ownerNames}
        baseStats={baseStats}
        kbStorageLimit={kbStorageLimit}
        currentUserId={currentUserId}
        role={role}
        kbTeams={kbTeams}
        initialSelection={initialSelection}
        initialTrees={initialTrees}
        onCreate={() => setCreateOpen(true)}
        heroImageSrc={heroImageSrc}
        routing={routing}
        urlSync={urlSync}
      />

      <CreateBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSegment}
        currentUserId={currentUserId}
        role={role}
        routing={routing}
      />
    </>
  );
}
