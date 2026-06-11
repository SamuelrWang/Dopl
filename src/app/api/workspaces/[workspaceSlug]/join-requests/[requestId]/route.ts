import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { resolveJoinRequest } from "@/features/workspaces/server/join-links";

const ResolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    role: z.enum(["admin", "member", "viewer"]).default("member"),
  }),
  z.object({ action: z.literal("decline") }),
]);

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * PATCH /api/workspaces/[workspaceSlug]/join-requests/[requestId] —
 * approve (with role) or decline a pending join request. Admin+.
 */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      const requestId = params?.requestId;
      if (!workspace || !requestId) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const input = await parseJson(request, ResolveSchema);
      await resolveJoinRequest(
        workspace.id,
        userId,
        requestId,
        input.action === "approve"
          ? { kind: "approve", role: input.role }
          : { kind: "decline" }
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
