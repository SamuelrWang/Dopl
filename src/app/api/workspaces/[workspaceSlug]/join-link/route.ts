import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveApiWorkspace } from "@/features/workspaces/server/segment";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  getOrCreateJoinLink,
  rotateJoinLink,
} from "@/features/workspaces/server/join-links";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/** GET /api/workspaces/[workspaceSlug]/join-link — the standing shareable link token. Admin+. */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const { token } = await getOrCreateJoinLink(workspace.id, userId);
      return NextResponse.json({ token });
    } catch (err) {
      return toErrorResponse(err);
    }
  }
);

/** POST /api/workspaces/[workspaceSlug]/join-link — rotate (invalidate + remint). Admin+. */
export const POST = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const workspace = await resolveApiWorkspace(params?.workspaceSlug ?? "", userId);
      if (!workspace) {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
      }
      const { token } = await rotateJoinLink(workspace.id, userId);
      return NextResponse.json({ token });
    } catch (err) {
      return toErrorResponse(err);
    }
  },
  // sessionOnly: rotating the shareable join link is an admin access-control
  // action (mints/invalidates workspace-entry credentials), not an agent one.
  { sessionOnly: true }
);

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workspaces/[workspaceSlug]/join-link", err);
}
