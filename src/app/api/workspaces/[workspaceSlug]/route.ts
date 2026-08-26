import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson, validationResponseBody } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { WorkspaceUpdateSchema } from "@/features/workspaces/schema";
import {
  deleteWorkspaceForUser,
  renameWorkspace,
  resolveMembershipOrThrow,
} from "@/features/workspaces/server/service";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/** GET — one workspace by slug, scoped to the caller: (owner_id, slug) first, then
 *  membership-by-slug across workspaces the caller belongs to.
 *  ⚠ `viewer`+ since 2026-08-26 — `resolveApiWorkspace`'s inverted default
 *  (`segment.ts › ApiWorkspaceOpts`). A `guest` gets the non-member 404. */
export const GET = withUserAuth(async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }

    // Owner-side lookup is the fast path; membership lookup joins through workspace_members.
    const workspace = await resolveApiWorkspace(workspaceSlug, userId, { apiKeyWorkspaceId });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const { membership } = await resolveMembershipOrThrow(workspace.id, userId);
    return NextResponse.json({ workspace, role: membership.role });
  } catch (err) {
    return toHttpErrorResponse("api/workspaces/[workspaceSlug]", err);
  }
});

/** PATCH — rename / edit description. Admin+; `renameWorkspace` enforces the gate. */
export const PATCH = withUserAuth(async (request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await resolveApiWorkspace(workspaceSlug, userId, { apiKeyWorkspaceId });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const input = await parseJson(request, WorkspaceUpdateSchema);
    const updated = await renameWorkspace(workspace.id, userId, input);
    return NextResponse.json({ workspace: updated });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(validationResponseBody(err), { status: err.status });
    }
    return toHttpErrorResponse("api/workspaces/[workspaceSlug]", err);
  }
});

/** DELETE — owner-only. Cascades clusters / panels / memberships / invitations via FK. */
export const DELETE = withUserAuth(async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.workspaceSlug;
    if (!workspaceSlug) {
      return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
    }
    const workspace = await resolveApiWorkspace(workspaceSlug, userId, { apiKeyWorkspaceId });
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    await deleteWorkspaceForUser(workspace.id, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toHttpErrorResponse("api/workspaces/[workspaceSlug]", err);
  }
// sessionOnly: destroying a workspace cascades KBs/skills/clusters/members — never an agent.
}, { sessionOnly: true });
