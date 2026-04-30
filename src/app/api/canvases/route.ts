import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { CanvasCreateSchema } from "@/features/canvases/schema";
import {
  createCanvasForUser,
  listMyCanvases,
} from "@/features/canvases/server/service";

/**
 * GET /api/canvases — list every canvas the caller is an active member of.
 */
export const GET = withUserAuth(async (_request, { userId }) => {
  try {
    const canvases = await listMyCanvases(userId);
    return NextResponse.json({ canvases });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

/**
 * POST /api/canvases — create a new canvas owned by the caller.
 */
export const POST = withUserAuth(async (request: NextRequest, { userId }) => {
  try {
    const input = await parseJson(request, CanvasCreateSchema);
    const canvas = await createCanvasForUser(userId, input);
    return NextResponse.json({ canvas }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(err.toResponseBody(), { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
