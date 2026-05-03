import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import {
  findWorkspaceForMember,
  listWorkspaceMembers,
} from "@/features/workspaces/server/service";
import { supabaseAdmin } from "@/shared/supabase/admin";

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
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json(
          { error: "Workspace not found" },
          { status: 404 }
        );
      }

      const members = await listWorkspaceMembers(workspace.id, userId);

      // Hydrate email + display name + avatar from auth.users so the UI
      // can render real names and profile pics. auth.admin.getUserById
      // is one call per user; n is small so no batching is needed yet,
      // but we cap at 100 just in case.
      const db = supabaseAdmin();
      const emails = new Map<string, string | null>();
      const displayNames = new Map<string, string | null>();
      const avatarUrls = new Map<string, string | null>();
      for (const m of members.slice(0, 100)) {
        try {
          const { data } = await db.auth.admin.getUserById(m.userId);
          const u = data?.user;
          const meta = (u?.user_metadata ?? {}) as {
            display_name?: string;
            full_name?: string;
            name?: string;
            avatar_url?: string;
          };
          emails.set(m.userId, u?.email ?? null);
          displayNames.set(
            m.userId,
            meta.display_name ?? meta.full_name ?? meta.name ?? null
          );
          avatarUrls.set(m.userId, meta.avatar_url ?? null);
        } catch {
          emails.set(m.userId, null);
          displayNames.set(m.userId, null);
          avatarUrls.set(m.userId, null);
        }
      }

      const hydrated = members.map((m) => ({
        ...m,
        email: emails.get(m.userId) ?? null,
        displayName: displayNames.get(m.userId) ?? null,
        avatarUrl: avatarUrls.get(m.userId) ?? null,
      }));

      return NextResponse.json({ members: hydrated });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
