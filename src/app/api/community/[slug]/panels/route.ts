import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { updatePanelPositions } from "@/features/community/server/service";

/**
 * PATCH /api/community/[slug]/panels — Update panel positions.
 * Used by the creator when editing the published canvas layout.
 * Requires auth + ownership.
 *
 * Body: { panels: [{ id, x, y }] }
 */
const handlePatch = withUserAuth(async (
  request: NextRequest,
  context: { userId: string; params?: Record<string, string> }
) => {
  try {
    const slug = context.params?.slug;
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const body = await request.json();
    const { panels } = body;

    if (!Array.isArray(panels)) {
      return NextResponse.json(
        { error: "panels array is required" },
        { status: 400 }
      );
    }

    await updatePanelPositions(slug, context.userId, panels);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("Not authorized")
      ? 403
      : message.includes("not found")
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

export const PATCH = handlePatch;
