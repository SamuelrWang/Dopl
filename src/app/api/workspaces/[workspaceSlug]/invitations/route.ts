import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { InvitationCreateSchema } from "@/features/workspaces/schema";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  createInvitation,
  listWorkspaceInvitations,
} from "@/features/workspaces/server/invitations";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** GET — pending invitations. Admin+, enforced inside `listWorkspaceInvitations`. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const invitations = await listWorkspaceInvitations(workspace.id, userId);
      return NextResponse.json({ invitations });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/invitations", err);
    }
  }
);

/** POST — create an invitation. Admin+, enforced inside `createInvitation`. Returns the row
 *  INCLUDING the magic-link token; the inviter copies the URL until email send is wired. */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, InvitationCreateSchema);
      const invitation = await createInvitation({
        workspaceId: workspace.id,
        invitedBy: userId,
        email: input.email,
        role: input.role,
        teamIds: input.teamIds,
      });
      return NextResponse.json({ invitation }, { status: 201 });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/invitations", err);
    }
  },
  // sessionOnly: inviting a member is an admin action.
  { sessionOnly: true }
);
