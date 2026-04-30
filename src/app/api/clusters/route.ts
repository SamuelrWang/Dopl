import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
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
  { userId, workspaceId }: { userId: string; workspaceId: string }
) {
  try {
    const clusters = await listClusters({ userId, workspaceId });
    return NextResponse.json({ clusters });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handlePost(
  request: NextRequest,
  { userId, workspaceId }: { userId: string; workspaceId: string }
) {
  try {
    const input = await parseJson(request, ClusterCreateSchema);
    const cluster = await createCluster(
      { name: input.name, entry_ids: input.entry_ids },
      { userId, workspaceId }
    );
    return NextResponse.json(cluster, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "editor" });
