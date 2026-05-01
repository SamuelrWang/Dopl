import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { HttpError } from "@/shared/lib/http-error";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import { findCanvasBySlug } from "@/features/workspaces/server/canvases";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[workspaceSlug]/canvases/[canvasSlug] — fetch a single
 * canvas by slug, scoped to the workspace. 404 on either workspace or
 * canvas miss.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const workspaceSlug = params?.slug;
    const canvasSlug = params?.canvasSlug;
    if (!workspaceSlug || !canvasSlug) {
      return NextResponse.json(
        { error: "workspaceSlug and canvasSlug required" },
        { status: 400 }
      );
    }
    const workspace = await findWorkspaceForMember(userId, workspaceSlug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const canvas = await findCanvasBySlug(workspace.id, canvasSlug);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    return NextResponse.json({ canvas });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
