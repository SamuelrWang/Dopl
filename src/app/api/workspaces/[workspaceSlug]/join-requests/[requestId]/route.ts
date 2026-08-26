import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { resolveJoinRequest } from "@/features/workspaces/server/join-links";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

const ResolveSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    role: z.enum(["admin", "member", "viewer"]).default("member"),
  }),
  z.object({ action: z.literal("decline") }),
]);

interface Ctx {
  userId: string;
  /** The credential's container lock, threaded into the resolver (§4). */
  apiKeyWorkspaceId?: string | null;
  params?: Record<string, string>;
}

/** PATCH — approve (with role) or decline a pending join request. Admin+. */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, apiKeyWorkspaceId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId, { apiKeyWorkspaceId });
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
      return toHttpErrorResponse("api/workspaces/[workspaceSlug]/join-requests/[requestId]", err);
    }
  },
  // sessionOnly: an admin action.
  { sessionOnly: true }
);
