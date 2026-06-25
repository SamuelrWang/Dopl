"use client";

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase } from "../../types";
import { CreateBaseDialog } from "../create-base-dialog";
import { KnowledgeV2 } from "./knowledge-v2";
import type { BaseTree, KbTeamRef, Selection } from "./types";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  bases: KnowledgeBase[];
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams granted, for the base overview. */
  kbTeams?: Record<string, KbTeamRef[]>;
  /** SSR-resolved deep-link target (base/entry), if the route carried one. */
  initialSelection?: Selection | null;
  /** SSR-resolved trees to seed (the deep-linked base), keyed by baseId. */
  initialTrees?: Record<string, BaseTree>;
}

/**
 * Knowledge V2 entry point. Mounts the two-pane redesign plus the shared
 * create-base dialog (opened from the list pane's "+"). The surrounding app
 * shell is mounted by the (app) layout.
 */
export function KnowledgeV2Preview({
  workspaceSegment,
  workspaceId,
  bases,
  currentUserId,
  role,
  kbTeams,
  initialSelection,
  initialTrees,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <KnowledgeV2
        workspaceId={workspaceId}
        workspaceSegment={workspaceSegment}
        bases={bases}
        currentUserId={currentUserId}
        role={role}
        kbTeams={kbTeams}
        initialSelection={initialSelection}
        initialTrees={initialTrees}
        onCreate={() => setCreateOpen(true)}
      />

      <CreateBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSegment}
        currentUserId={currentUserId}
        role={role}
      />
    </>
  );
}
