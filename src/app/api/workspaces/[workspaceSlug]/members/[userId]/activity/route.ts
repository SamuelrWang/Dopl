import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { resolveMembershipOrThrow } from "@/features/workspaces/server/service";
import { meetsMinRole } from "@/features/workspaces/types";
import { getAccessMatrix, listTeams } from "@/features/teams/server/service";
import { computeEffectiveAccess } from "@/features/teams/effective-access";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  filterActivity,
  reachableResourceIds,
} from "@/features/members/activity-visibility";
import {
  callerTeamIds,
  listMemberActivity,
} from "@/features/members/server/activity";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET — one member's recent activity, FILTERED BY THE CALLER'S OWN ACCESS.
 *
 * A row survives iff it is workspace-level (`resourceType: null` — roster facts
 * every member can read off the members list) or the CALLER reaches its
 * resource. Self and admins are unfiltered.
 *
 * ⚠ The filter runs HERE, not in the renderer. Returning the whole feed and
 * hiding rows client-side would put them in the payload, which is the leak this
 * endpoint exists to prevent. Shape `{ events: ActivityEventRow[] }`.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const targetUserId = params?.userId;
    if (!targetUserId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const { membership: caller } = await resolveMembershipOrThrow(workspace.id, userId);
    // Confirms the target is a member of THIS workspace before anything is read.
    await resolveMembershipOrThrow(workspace.id, targetUserId);

    const events = await listMemberActivity(workspace.id, targetUserId);
    const unfiltered = targetUserId === userId || meetsMinRole(caller.role, "admin");

    if (unfiltered) {
      return NextResponse.json(
        { events },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // Peer: resolve what the CALLER reaches, never the target.
    const [teams, matrix, teamIds] = await Promise.all([
      listTeams(workspace.id, userId),
      getAccessMatrix(workspace.id, userId),
      callerTeamIds(workspace.id, userId),
    ]);
    const callerAccess = computeEffectiveAccess({
      memberUserId: userId,
      memberRole: caller.role,
      teams,
      resources: matrix.resources,
    });

    return NextResponse.json(
      {
        events: filterActivity(events, {
          unfiltered: false,
          reachable: reachableResourceIds(callerAccess),
          callerTeamIds: teamIds,
        }),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return toHttpErrorResponse(
      "api/workspaces/[workspaceSlug]/members/[userId]/activity",
      err
    );
  }
});
