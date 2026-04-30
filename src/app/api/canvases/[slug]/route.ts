import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { CanvasUpdateSchema } from "@/features/canvases/schema";
import {
  deleteCanvasForUser,
  findCanvasForMember,
  renameCanvas,
  resolveMembershipOrThrow,
} from "@/features/canvases/server/service";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/canvases/[slug] — fetch one canvas by slug, scoped to the
 * caller. Looks up by (owner_id, slug) first; if not found, falls back
 * to membership-by-slug across canvases the caller is a member of.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }

    // Owner-side lookup is the fast path. Most calls hit a canvas the
    // caller owns. Membership lookup (canvases owned by other users that
    // the caller has been invited to) lands in Phase 4 and joins through
    // canvas_members.
    const canvas = await findCanvasForMember(userId, slug);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    const { membership } = await resolveMembershipOrThrow(canvas.id, userId);
    return NextResponse.json({ canvas, role: membership.role });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * PATCH /api/canvases/[slug] — rename / edit description. Admin+ only;
 * `renameCanvas` enforces the role gate.
 */
export const PATCH = withUserAuth(async (request: NextRequest, { userId, params }: Ctx) => {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const canvas = await findCanvasForMember(userId, slug);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    const input = await parseJson(request, CanvasUpdateSchema);
    const updated = await renameCanvas(canvas.id, userId, input);
    return NextResponse.json({ canvas: updated });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * DELETE /api/canvases/[slug] — owner-only. Cascades clusters / panels /
 * brain / memberships / invitations via FK ON DELETE CASCADE.
 */
export const DELETE = withUserAuth(async (_request: NextRequest, { userId, params }: Ctx) => {
  try {
    const slug = params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug required" }, { status: 400 });
    }
    const canvas = await findCanvasForMember(userId, slug);
    if (!canvas) {
      return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
    }
    await deleteCanvasForUser(canvas.id, userId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
