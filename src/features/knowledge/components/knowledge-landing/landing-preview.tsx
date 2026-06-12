"use client";

import { useState } from "react";
import type { Role } from "@/features/workspaces/types";
import type { KnowledgeBase } from "../../types";
import { CreateBaseDialog } from "../create-base-dialog";
import { LandingContent, type KbTeamRef } from "./landing-content";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  bases: KnowledgeBase[];
  currentUserId: string;
  role: Role;
  /** Admin-only: kbId → teams with a grant, for the card pills. */
  kbTeams?: Record<string, KbTeamRef[]>;
}

/**
 * Knowledge landing content: the hero + knowledge-base grid as the main
 * panel, plus the create-base dialog. The surrounding shell (rail,
 * sidebar, titlebar) is mounted once by the knowledge layout and
 * persists across navigation.
 */
export function KnowledgeLandingPreview({
  workspaceSegment,
  workspaceId,
  bases,
  currentUserId,
  role,
  kbTeams,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <LandingContent
        workspaceSegment={workspaceSegment}
        bases={bases}
        kbTeams={kbTeams}
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
