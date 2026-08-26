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
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/**
 * GET — a member's effective access on every resource, resolved SERVER-side so the member drawer
 * and the enforcement path share one implementation (`computeEffectiveAccess`).
 * Admins+ for anyone; regular members only for themselves. Shape `{ rows: EffectiveAccessRow[] }`.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
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
        // ⚠ 404, not 403 — member existence must not be an oracle for non-admins.
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

      // ⚠ SELF NEVER RECEIVES `level: null` ROWS. Naming the resources somebody
      // was deliberately not given leaks the shape of the workspace to the one
      // person the boundary was drawn against — and a payload they can read in
      // devtools is a leak whether or not the UI renders it. Admins auditing
      // ANOTHER member get the full matrix, negative space included.
      const visible =
        targetUserId === userId ? rows.filter((r) => r.level !== null) : rows;
      return NextResponse.json({ rows: visible });
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
