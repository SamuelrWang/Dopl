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
import { workspaceSegment } from "@/features/workspaces/url";
import {
  buildKnowledgeContext,
  listBases,
} from "@/features/knowledge/server/service";
import { KnowledgeLandingPreview } from "@/features/knowledge/components/knowledge-landing/landing-preview";

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
  const ctx = buildKnowledgeContext({
    userId: user.id,
    workspaceId: workspace.id,
    agentTokenId: null,
  });
  const bases = await listBases(ctx);
  const segment = workspaceSegment(workspace);

  return (
    <KnowledgeLandingPreview
      workspaceSegment={segment}
      workspaceId={workspace.id}
      bases={bases}
    />
  );
}
