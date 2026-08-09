import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listWorkspaceMembers } from "@/features/workspaces/server/service";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listTeamRefsByUser } from "@/features/teams/server/repository";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/members — list members of a workspace. Any
 * active member can read. Hydrates each row with the member's email +
 * display name so the UI can render without a second hop.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId);
      if (!workspace) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 }
        );
      }

      const [members, teamsByUser] = await Promise.all([
        listWorkspaceMembers(workspace.id, userId),
        listTeamRefsByUser(workspace.id),
      ]);

      const profiles = await listProfileSummaries(members.map((m) => m.userId));

      const hydrated = members.map((m) => {
        const p = profiles.get(m.userId);
        return {
          ...m,
          email: p?.email ?? null,
          displayName: p?.displayName ?? null,
          avatarUrl: p?.avatarUrl ?? null,
          teams: teamsByUser.get(m.userId) ?? [],
        };
      });

      return NextResponse.json({ members: hydrated });
    } catch (err) {
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/members", err);
    }
  }
);
