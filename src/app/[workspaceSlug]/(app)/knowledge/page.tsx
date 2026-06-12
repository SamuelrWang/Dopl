/**
 * /[workspaceSlug]/knowledge — knowledge area landing.
 *
 * The sidebar "Knowledge" link points here. This route renders the new
 * design-language preview: a self-contained shell (workspace rail +
 * restyled sidebar + main panel) showing a grid of every knowledge base.
 * Clicking a base enters the existing tree view. The layout-shell bypasses
 * its global chrome for this route so the preview paints full-screen
 * without the current dark colorway.
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
  listBases,
} from "@/features/knowledge/server/service";
import { KnowledgeLandingPreview } from "@/features/knowledge/components/knowledge-landing/landing-preview";
import type { KbTeamRef } from "@/features/knowledge/components/knowledge-landing/landing-content";

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
    <KnowledgeLandingPreview
      workspaceSegment={segment}
      workspaceId={workspace.id}
      bases={bases}
      currentUserId={user.id}
      role={membership.role}
      kbTeams={kbTeams}
    />
  );
}
