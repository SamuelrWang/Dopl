"use client";

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase } from "../../types";
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
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** Pre-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** Pre-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
  /** The two router-shaped dependencies, injected (./routing.ts). */
  routing: KnowledgeRouting;
  urlSync?: KnowledgeUrlSync;
}

/**
 * Knowledge V2 entry point. Mounts the two-pane redesign plus the shared
 * create-base dialog (opened from the list pane's "+"). The surrounding app
 * shell is mounted by the host app's layout.
 *
 * Next-free by construction: `./landing-preview.tsx` is the web app's thin
 * wrapper that binds `routing` to `next/navigation`, and the desktop SPA
 * renders this component directly with a hash-router binding
 * (apps/desktop-ui/src/pages/knowledge/index.tsx).
 */
export function KnowledgeV2PreviewCore({
  workspaceSegment,
  workspaceId,
  bases,
  ownerNames,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
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
        currentUserId={currentUserId}
        role={role}
        kbTeams={kbTeams}
        initialSelection={initialSelection}
        initialTrees={initialTrees}
        onCreate={() => setCreateOpen(true)}
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
