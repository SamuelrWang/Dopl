/**
 * AppShell chrome for the canvas route (new design language).
 *
 * Same pattern as the (app) group layout: resolves the workspace once and
 * mounts the persistent shell (rail + sidebar + titlebar). The canvas
 * itself portals to <body> at z-[31], inset to the shell's white-panel
 * rect (--app-panel-* vars in globals.css), so the page's in-surface
 * children are effectively a transparent passthrough behind it.
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

export default async function CanvasLayout({ children, params }: LayoutProps) {
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
