/**
 * /[workspaceSlug]/knowledge — knowledge area, V2 two-pane UI.
 *
 * The sidebar "Knowledge" link points here. Lists every base in the middle
 * pane (expandable to its file tree) with the detail pane on the right. No
 * base is pre-selected at the index; /knowledge/[kbSlug] handles deep links.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { listTeams } from "@/features/teams/server/service";
import {
  buildKnowledgeContext,
  listBaseOwnerNames,
  listBases,
} from "@/features/knowledge/server/service";
import { KnowledgeV2Preview } from "@/features/knowledge/components/knowledge-v2/landing-preview";
import type { KbTeamRef } from "@/features/knowledge/components/knowledge-v2/types";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function KnowledgeIndexPage({ params }: PageProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await resolvePageWorkspace(
    workspaceSlug,
    user.id,
    "knowledge"
  );
  const { membership } = await resolveMembershipOrThrow(workspace.id, user.id);
  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    role: membership.role,
    agentTokenId: null,
  });
  const bases = await listBases(ctx);
  const ownerNames = await listBaseOwnerNames(ctx, bases);
  const segment = workspaceSegment(workspace);

  // Admin view: which teams have a grant on each teams-mode KB, for the
  // card pills. Members only get the scope label, so skip the query.
  let kbTeams: Record<string, KbTeamRef[]> | undefined;
  if (meetsMinRole(membership.role, "admin")) {
    const teams = await listTeams(workspace.id, user.id);
    kbTeams = {};
    for (const team of teams) {
      for (const grant of team.grants) {
        if (grant.resourceType !== "knowledge_base") continue;
        (kbTeams[grant.resourceId] ??= []).push({
          teamId: team.id,
          name: team.name,
          color: team.color,
        });
      }
    }
  }

  return (
    <KnowledgeV2Preview
      workspaceSegment={segment}
      workspaceId={workspace.id}
      bases={bases}
      ownerNames={ownerNames}
      currentUserId={user.id}
      role={membership.role}
      kbTeams={kbTeams}
    />
  );
}
