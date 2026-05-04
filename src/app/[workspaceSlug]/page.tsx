/**
 * /[workspaceSlug] — workspace root, redirects to the default canvas.
 *
 * For now every workspace has exactly one canvas (slug='main'), so this
 * just redirects there. Later phases may pick the user's last-active
 * canvas or render a workspace-level overview.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { ensureDefaultCanvas } from "@/features/workspaces/server/canvases";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceRootPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await resolvePageWorkspace(workspaceSlug, user.id);
  const canvas = await ensureDefaultCanvas(workspace.id);
  redirect(`/${workspaceSegment(workspace)}/${canvas.slug}`);
}
