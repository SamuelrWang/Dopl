"use client";

import { useState } from "react";
import type { KnowledgeBase } from "../../types";
import { CreateBaseDialog } from "../create-base-dialog";
import { LandingContent } from "./landing-content";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  bases: KnowledgeBase[];
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
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <LandingContent
        workspaceSegment={workspaceSegment}
        bases={bases}
        onCreate={() => setCreateOpen(true)}
      />

      <CreateBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSegment}
      />
    </>
  );
}
