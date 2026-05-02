import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { InvitationCreateSchema } from "@/features/workspaces/schema";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  createInvitation,
  listWorkspaceInvitations,
} from "@/features/workspaces/server/invitations";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/invitations — list pending invitations.
 * Admin+ only (enforced inside `listWorkspaceInvitations`).
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const invitations = await listWorkspaceInvitations(workspace.id, userId);
      return NextResponse.json({ invitations });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);

/**
 * POST /api/workspaces/[workspaceSlug]/invitations — create a new invitation.
 * Admin+ only (enforced inside `createInvitation`). Returns the
 * invitation row including the magic-link token; the inviter is
 * expected to copy the resulting URL until email send is wired.
 */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, InvitationCreateSchema);
      const invitation = await createInvitation({
        workspaceId: workspace.id,
        invitedBy: userId,
        email: input.email,
        role: input.role,
      });
      return NextResponse.json({ invitation }, { status: 201 });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
