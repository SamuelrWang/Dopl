import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listApiKeys } from "@/shared/auth/api-keys";
import { createWorkspaceKey } from "@/features/api-keys/server/service";
import { ActiveKeyExistsError } from "@/features/api-keys/server/errors";

/**
 * Per-member workspace API keys — exactly one ACTIVE key per
 * (user, workspace). The MCP server authenticates as the member who
 * owns the key, inheriting their role + audit trail.
 *
 * GET → current user's keys for this workspace (active + revoked).
 * POST → create the user's key for this workspace. 409 if one is
 *        already active (the UI must revoke it first).
 */

interface RouteContext {
  params: Promise<{ workspaceSlug: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = await context.params;
  const workspace = await resolveApiWorkspace(workspaceSlug, user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  const keys = await listApiKeys({
    userId: user.id,
    workspaceId: workspace.id,
  });
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workspaceSlug } = await context.params;
  const workspace = await resolveApiWorkspace(workspaceSlug, user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  const body = await request.json().catch(() => ({}));
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : "Workspace key";

  try {
    const result = await createWorkspaceKey(user.id, workspace.id, name);
    return NextResponse.json(
      {
        key: result.key,
        id: result.id,
        name: result.name,
        prefix: result.prefix,
        workspace_id: workspace.id,
        message: "Save this key — it will not be shown again.",
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof ActiveKeyExistsError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 409 }
      );
    }
    throw err;
  }
}
