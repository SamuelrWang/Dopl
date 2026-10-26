"use client";

/**
 * STAGING COPY of `apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane`,
 * ONTOLOGY BRANCH ONLY (`shown === ONTOLOGY_PANE`). The other faces (Overview,
 * Knowledge, Identities, Channel) are other staging pages.
 *
 * `identity` stands in for the boot payload (`POST /api/boot`): the home space id
 * (null until onboarded), its segment, and the reader.
 */

import { HomeOntologyPanels } from "./ontology-panels";

export interface StagingBootIdentity {
  workspace: { id: string } | null;
  segment: string | null;
  userId: string;
}

export function HomePane({ identity }: { identity: StagingBootIdentity }) {
  // An ontology is a personal item lent into channels, so this face takes the home space.
  return (
    <HomeOntologyPanels
      homeWorkspaceId={identity.workspace?.id ?? null}
      homeWorkspaceSegment={identity.segment}
      // Scopes the pane's last-opened memory to the reader (`last-opened.ts`).
      currentUserId={identity.userId}
    />
  );
}
