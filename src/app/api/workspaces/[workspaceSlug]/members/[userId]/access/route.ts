import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  listMemberOverrides,
  setResourceAccessOverride,
} from "@/features/members/server/access";

const SetAccessSchema = z.object({
  resourceType: z.enum(["knowledge_base", "skill", "canvas"]),
  resourceId: z.string().uuid(),
  level: z.enum(["read", "edit"]),
});

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[slug]/members/[userId]/access — list access
 * overrides for a single member. Admin+ only. The caller composes the
 * full matrix client-side by joining this list against the workspace's
 * KBs / skills / canvases.
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json(
          { error: "workspaceSlug + userId required" },
          { status: 400 }
        );
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const overrides = await listMemberOverrides(workspace.id, userId, targetUserId);
      return NextResponse.json({ overrides });
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
 * PUT /api/workspaces/[slug]/members/[userId]/access — set a single
 * override. Idempotent on (resourceType, resourceId).
 */
export const PUT = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspaceSlug = params?.workspaceSlug;
      const targetUserId = params?.userId;
      if (!workspaceSlug || !targetUserId) {
        return NextResponse.json(
          { error: "workspaceSlug + userId required" },
          { status: 400 }
        );
      }
      const workspace = await findWorkspaceForMember(userId, workspaceSlug);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, SetAccessSchema);
      await setResourceAccessOverride(
        workspace.id,
        userId,
        targetUserId,
        input.resourceType,
        input.resourceId,
        input.level
      );
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
