import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { CanvasCreateSchema } from "@/features/workspaces/schema";
import { findWorkspaceForMember } from "@/features/workspaces/server/service";
import {
  createCanvas,
  listCanvasesForWorkspace,
} from "@/features/workspaces/server/canvases";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/workspaces/[slug]/canvases — list every canvas (page) inside
 * the workspace identified by slug. Caller must be an active member.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const workspace = await findWorkspaceForMember(userId, slug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const canvases = await listCanvasesForWorkspace(workspace.id);
    return NextResponse.json({ canvases });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * POST /api/workspaces/[slug]/canvases — add a new canvas inside the
 * workspace. Membership-only for now (any active member can create);
 * tighten to editor+ if/when free-for-all becomes a problem.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId, params }: Ctx) => {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const workspace = await findWorkspaceForMember(userId, slug);
    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    const input = await parseJson(request, CanvasCreateSchema);
    const canvas = await createCanvas(workspace.id, input);
    return NextResponse.json({ canvas }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
