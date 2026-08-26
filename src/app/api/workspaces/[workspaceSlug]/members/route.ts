import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { listWorkspaceMembers } from "@/features/workspaces/server/service";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { listTeamRefsByUser } from "@/features/teams/server/repository";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/** GET — workspace members. Rows hydrate email + display name so the UI renders
 *  without a second hop.
 *
 *  ⚠ `viewer`+, NOT "any active member" (corrected 2026-08-26). This route hands
 *  out EVERY member's email, display name, avatar and team list, and it sat on
 *  `resolveApiWorkspace`, which proved membership EXISTENCE only — so a `guest`
 *  read the whole roster, which is precisely what INVARIANTS §4A claimed it
 *  could not. The floor is the resolver's new inverted default (`segment.ts ›
 *  ApiWorkspaceOpts`); a guest now gets the same 404 a non-member does. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      if (!workspaceSlug) {
        return NextResponse.json({ error: "workspaceSlug required" }, { status: 400 });
      }
      const workspace = await resolveApiWorkspace(workspaceSlug, userId, { apiKeyWorkspaceId });
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
