import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { resolveActiveCanvas } from "@/features/canvases/server/service";
import { HttpError } from "@/shared/lib/http-error";

/**
 * GET /api/canvases/me — return the canvas the caller is currently
 * scoped to (resolved by the X-Canvas-Id header, falling back to the
 * user's default canvas) plus their role on it.
 *
 * Used by the MCP server's startup handshake to confirm the requested
 * canvas exists and the caller is an active member, and to print the
 * canvas name in stderr boot output.
 */
export const GET = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const headerCanvasId = request.headers.get("x-canvas-id");
    const { canvas, membership } = await resolveActiveCanvas(
      userId,
      headerCanvasId
    );
    return NextResponse.json({ canvas, role: membership.role });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
