import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCanvasAuth } from "@/shared/auth/with-canvas-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { createCluster, listClusters } from "@/features/clusters/server/service";

const ClusterCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  entry_ids: z.array(z.string().uuid()).optional().default([]),
});

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 }
  );
}

async function handleGet(
  _request: NextRequest,
  { userId, canvasId }: { userId: string; canvasId: string }
) {
  try {
    const clusters = await listClusters({ userId, canvasId });
    return NextResponse.json({ clusters });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handlePost(
  request: NextRequest,
  { userId, canvasId }: { userId: string; canvasId: string }
) {
  try {
    const input = await parseJson(request, ClusterCreateSchema);
    const cluster = await createCluster(
      { name: input.name, entry_ids: input.entry_ids },
      { userId, canvasId }
    );
    return NextResponse.json(cluster, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withCanvasAuth(handleGet);
export const POST = withCanvasAuth(handlePost, { minRole: "editor" });
