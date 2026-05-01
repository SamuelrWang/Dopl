import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { revokeApiKey } from "@/shared/auth/api-keys";

interface RouteContext {
  params: Promise<{ workspaceSlug: string; id: string }>;
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug, id } = await context.params;
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { membership } = await resolveMembershipOrThrow(
    workspace.id,
    user.id
  );
  if (!meetsMinRole(membership.role, "admin")) {
    return NextResponse.json(
      {
        error: {
          code: "WORKSPACE_FORBIDDEN",
          message: "Only admins can revoke workspace API keys",
        },
      },
      { status: 403 }
    );
  }

  try {
    await revokeApiKey(id, { workspaceId: workspace.id });
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
