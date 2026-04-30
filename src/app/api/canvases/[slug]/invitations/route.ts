import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { InvitationCreateSchema } from "@/features/canvases/schema";
import { findCanvasForMember } from "@/features/canvases/server/service";
import {
  createInvitation,
  listCanvasInvitations,
} from "@/features/canvases/server/invitations";

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * GET /api/canvases/[slug]/invitations — list pending invitations.
 * Admin+ only (enforced inside `listCanvasInvitations`).
 */
export const GET = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const slug = params?.slug;
      if (!slug) {
        return NextResponse.json({ error: "slug required" }, { status: 400 });
      }
      const canvas = await findCanvasForMember(userId, slug);
      if (!canvas) {
        return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
      }
      const invitations = await listCanvasInvitations(canvas.id, userId);
      return NextResponse.json({ invitations });
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
 * POST /api/canvases/[slug]/invitations — create a new invitation.
 * Admin+ only (enforced inside `createInvitation`). Returns the
 * invitation row including the magic-link token; the inviter is
 * expected to copy the resulting URL until email send is wired.
 */
export const POST = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const slug = params?.slug;
      if (!slug) {
        return NextResponse.json({ error: "slug required" }, { status: 400 });
      }
      const canvas = await findCanvasForMember(userId, slug);
      if (!canvas) {
        return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
      }
      const input = await parseJson(request, InvitationCreateSchema);
      const invitation = await createInvitation({
        canvasId: canvas.id,
        invitedBy: userId,
        email: input.email,
        role: input.role,
      });
      return NextResponse.json({ invitation }, { status: 201 });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
