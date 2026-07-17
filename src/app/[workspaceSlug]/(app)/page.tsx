/**
 * /[workspaceSlug] — workspace root, redirects to the Canvas tab.
 *
 * Lives inside the (app) group so the AppShell stays mounted while the
 * redirect resolves — hopping sidebar → Canvas never tears down the
 * shell (that teardown was a full-screen background flash).
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolvePageWorkspace } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { isOnboarded } from "@/features/onboarding/server/service";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceRootPage({ params }: PageProps) {
  const { workspaceSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  // First-run users finish onboarding before entering a workspace.
  if (!(await isOnboarded(user.id))) redirect("/onboarding");

  const workspace = await resolvePageWorkspace(workspaceSlug, user.id);
  redirect(`/${workspaceSegment(workspace)}/canvas`);
}
