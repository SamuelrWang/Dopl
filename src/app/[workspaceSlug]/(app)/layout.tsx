/**
 * Persistent shell for every named workspace sub-page (overview, chat,
 * knowledge, skills, members, settings) — the (app) route group.
 *
 * Mounting the AppShell here — instead of per-page — means the rail,
 * sidebar, titlebar, workspaces fetch, and settings-modal state all
 * survive navigation between these pages. Only the white content panel
 * re-renders, covered by each route's loading skeleton. MyAccessProvider
 * lives here too so the access fetch is shared instead of re-firing per
 * navigation.
 *
 * The canvas route ([canvasSlug]) deliberately sits OUTSIDE this group:
 * it keeps the legacy chrome + colorway until its own conversion pass.
 *
 * Canonical-slug redirects stay in the pages (they know their full
 * sub-path); the layout just resolves and renders, and 404s when the
 * user can't reach the workspace at all.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { resolveWorkspaceSegmentForUser } from "@/features/workspaces/server/segment";
import { workspaceSegment } from "@/features/workspaces/url";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { AppShell } from "@/shared/layout/app-shell";

export const dynamic = "force-dynamic";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}

export default async function WorkspaceAppLayout({ children, params }: LayoutProps) {
  const { workspaceSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const resolved = await resolveWorkspaceSegmentForUser(workspaceSlug, user.id);
  if (!resolved) notFound();
  const ws = resolved.workspace;
  const segment = workspaceSegment(ws);

  return (
    <AppShell
      workspaceSegment={segment}
      workspaceId={ws.id}
      workspacePublicId={ws.publicId}
      workspaceName={ws.name}
    >
      <MyAccessProvider workspaceSegment={segment}>{children}</MyAccessProvider>
    </AppShell>
  );
}
