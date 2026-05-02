import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { createApiKey, listApiKeys } from "@/shared/auth/api-keys";

/**
 * Per-member workspace API keys.
 *
 * Each member has their own keys scoped to a workspace. The MCP server
 * authenticates as the *member* who owns the key, inheriting their
 * role + audit trail. Admins do not see other members' keys.
 *
 * GET → current user's own keys for this workspace.
 * POST → create a new key bound to the current user + workspace.
 *        Any active member can self-provision.
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
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
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
  const workspace = await findWorkspaceForMember(user.id, workspaceSlug);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "name is required" } },
      { status: 400 }
    );
  }

  const result = await createApiKey(name, user.id, workspace.id);

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
}
