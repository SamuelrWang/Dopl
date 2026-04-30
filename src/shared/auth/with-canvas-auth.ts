import { NextRequest, NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { resolveActiveCanvas } from "@/features/canvases/server/service";
import type { Role } from "@/features/canvases/types";
import { meetsMinRole } from "@/features/canvases/types";
import { withUserAuth } from "./with-auth";

export interface CanvasAuthContext {
  userId: string;
  apiKeyId?: string;
  canvasId: string;
  canvasSlug: string;
  role: Role;
  params?: Record<string, string>;
}

interface Options {
  /**
   * Minimum membership role required to call this route. Defaults to
   * "viewer" — any active member can access. Use "editor" for writes,
   * "admin" for invitations / settings, "owner" for delete.
   */
  minRole?: Role;
}

/**
 * Composes `withUserAuth` to additionally resolve the active canvas
 * (`X-Canvas-Id` header, falling back to the user's default canvas) and
 * verify the caller's membership + role. Injects `{ canvasId, canvasSlug,
 * role }` alongside the standard `{ userId, apiKeyId }`.
 *
 * Routes that scope per-canvas should use this in place of
 * `withUserAuth`. Routes that operate user-globally (settings, billing,
 * the global entry KB, admin) keep `withUserAuth`.
 */
export function withCanvasAuth(
  handler: (
    request: NextRequest,
    context: CanvasAuthContext
  ) => Promise<Response | NextResponse>,
  options: Options = {}
) {
  const minRole: Role = options.minRole ?? "viewer";
  return withUserAuth(async (request, ctx) => {
    const headerCanvasId = request.headers.get("x-canvas-id");
    try {
      const { canvas, membership } = await resolveActiveCanvas(
        ctx.userId,
        headerCanvasId
      );
      if (!meetsMinRole(membership.role, minRole)) {
        return NextResponse.json(
          new HttpError(
            403,
            "CANVAS_FORBIDDEN",
            `Requires ${minRole} role or higher`
          ).toResponseBody(),
          { status: 403 }
        );
      }
      return handler(request, {
        userId: ctx.userId,
        apiKeyId: ctx.apiKeyId,
        canvasId: canvas.id,
        canvasSlug: canvas.slug,
        role: membership.role,
        params: ctx.params,
      });
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json(err.toResponseBody(), { status: err.status });
      }
      throw err;
    }
  });
}
