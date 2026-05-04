import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { revokeApiKey } from "@/shared/auth/api-keys";

interface RouteContext {
  params: Promise<{ workspaceSlug: string; id: string }>;
}

/**
 * Revoke one of the current user's own keys for this workspace. The
 * `userId` + `workspaceId` filter on `revokeApiKey` ensures a member
 * can't revoke another member's key by guessing its id.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug, id } = await context.params;
  const workspace = await resolveApiWorkspace(workspaceSlug, user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  try {
    await revokeApiKey(id, { userId: user.id, workspaceId: workspace.id });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to revoke key";
    return NextResponse.json(
      { error: { code: "REVOKE_FAILED", message } },
      { status: 400 }
    );
  }
}
