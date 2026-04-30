/**
 * /[workspaceSlug]/[canvasSlug] — server-rendered canvas editor for a
 * specific canvas inside a specific workspace.
 *
 * Resolves both segments before any data load:
 *   1. workspace by slug (membership-scoped)
 *   2. canvas by slug (within the workspace)
 *
 * Panels + canvas state are still keyed to workspace_id today — the
 * canvas-as-page concept is wired through the URL and resolved here, but
 * panel positions don't yet split by canvas. That migration lands when
 * multi-canvas-per-workspace becomes a real product surface.
 */

import { notFound, redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import {
  loadCanvasConversations,
  loadCanvasInitialState,
} from "@/features/canvas/server/load-server-state";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { findCanvasBySlug } from "@/features/workspaces/server/canvases";
import CanvasClientShell from "@/features/canvas/canvas-client-shell";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string; canvasSlug: string }>;
}

export default async function WorkspaceCanvasPage({ params }: PageProps) {
  const { workspaceSlug, canvasSlug } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) notFound();
  await resolveMembershipOrThrow(workspace.id, user.id);

  const canvas = await findCanvasBySlug(workspace.id, canvasSlug);
  if (!canvas) notFound();

  const scope = { userId: user.id, workspaceId: workspace.id };
  const conversations = await loadCanvasConversations(scope);
  const initialState = await loadCanvasInitialState(scope, conversations);

  return (
    <CanvasClientShell
      userId={user.id}
      workspaceId={workspace.id}
      canvasSlug={canvas.slug}
      initialState={initialState}
      initialConversations={conversations}
    />
  );
}
