import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { getAccessMatrix, listTeams } from "@/features/teams/server/service";
import { computeEffectiveAccess } from "@/features/teams/effective-access";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/members/[userId]/access — a
 * member's effective access on every resource, resolved SERVER-side so
 * the member drawer and the enforcement path share one implementation
 * (computeEffectiveAccess over server-fetched teams + resources).
 *
 * Callers: admins+ for anyone; regular members only for themselves.
 * Shape: { rows: EffectiveAccessRow[] }
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const targetUserId = params?.userId;
      if (!targetUserId) {
        return NextResponse.json({ error: "userId required" }, { status: 400 });
      }

      const { membership: caller } = await resolveMembershipOrThrow(
        workspace.id,
        userId
      );
      if (targetUserId !== userId && !meetsMinRole(caller.role, "admin")) {
        // 404 (not 403) so member existence isn't an oracle for non-admins.
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const { membership: target } = await resolveMembershipOrThrow(
        workspace.id,
        targetUserId
      );
      const [teams, matrix] = await Promise.all([
        listTeams(workspace.id, userId),
        getAccessMatrix(workspace.id, userId),
      ]);

      const rows = computeEffectiveAccess({
        memberUserId: targetUserId,
        memberRole: target.role,
        teams,
        resources: matrix.resources,
      });
      return NextResponse.json({ rows });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(
          { error: { code: err.code, message: err.message } },
          { status: err.status }
        );
      }
      console.error("[members/access] failed:", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
