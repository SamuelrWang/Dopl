import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { findCanvasForMember } from "@/features/canvases/server/service";
import {
  removeMember,
  updateMemberRole,
} from "@/features/canvases/server/invitations";

const RoleUpdateSchema = z.object({
  role: z.enum(["owner", "admin", "editor", "viewer"]),
});

interface Ctx {
  userId: string;
  params?: Record<string, string>;
}

/**
 * PATCH /api/canvases/[slug]/members/[userId] — change a member's role.
 * Admin+ only. Last-owner protection enforced inside `updateMemberRole`.
 */
export const PATCH = withUserAuth(
  async (request: NextRequest, { userId, params }: Ctx) => {
    try {
      const slug = params?.slug;
      const targetUserId = params?.userId;
      if (!slug || !targetUserId) {
        return NextResponse.json({ error: "slug + userId required" }, { status: 400 });
      }
      const canvas = await findCanvasForMember(userId, slug);
      if (!canvas) {
        return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
      }
      const { role } = await parseJson(request, RoleUpdateSchema);
      await updateMemberRole(canvas.id, userId, targetUserId, role);
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

/**
 * DELETE /api/canvases/[slug]/members/[userId] — remove a member.
 * Admin+ only. Cannot remove last owner.
 */
export const DELETE = withUserAuth(
  async (_request: NextRequest, { userId, params }: Ctx) => {
    try {
      const slug = params?.slug;
      const targetUserId = params?.userId;
      if (!slug || !targetUserId) {
        return NextResponse.json({ error: "slug + userId required" }, { status: 400 });
      }
      const canvas = await findCanvasForMember(userId, slug);
      if (!canvas) {
        return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
      }
      await removeMember(canvas.id, userId, targetUserId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }
);
