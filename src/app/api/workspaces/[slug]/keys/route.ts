import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/shared/supabase/server";
import {
  findWorkspaceForMember,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { createApiKey, listApiKeys } from "@/shared/auth/api-keys";

/**
 * Workspace-scoped API keys (Item 5.B).
 *
 * GET → list keys locked to this workspace.
 * POST → create a new workspace-scoped key. Returns plaintext once.
 *
 * Membership requirements:
 *   - GET: viewer+ (any active member can see what keys exist)
 *   - POST: admin+ (creating a key grants automation access; should
 *     be limited to admins so editors can't auto-provision MCP keys)
 */

interface RouteContext {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await context.params;
  const workspace = await findWorkspaceForMember(user.id, slug);
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await resolveMembershipOrThrow(workspace.id, user.id);

  const keys = await listApiKeys({ workspaceId: workspace.id });
  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await context.params;
  const workspace = await findWorkspaceForMember(user.id, slug);
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
          message: "Only admins can create workspace API keys",
        },
      },
      { status: 403 }
    );
  }

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
