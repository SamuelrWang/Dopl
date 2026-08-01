import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@/features/workspaces/types";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { createCluster, listClusters } from "@/features/clusters/server/service";
import { DESCRIPTION_MAX } from "@/config";
import { ClusterNameSchema } from "@/features/clusters/schema";

const ClusterCreateSchema = z.object({
  name: ClusterNameSchema,
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
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
  { userId, workspaceId, role, agentTokenId }: { userId: string; workspaceId: string; role: Role; agentTokenId?: string }
) {
  try {
    const clusters = await listClusters({
      userId,
      workspaceId,
      role,
      source: agentTokenId ? "agent" : "user",
    });
    return NextResponse.json({ clusters });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handlePost(
  request: NextRequest,
  { userId, workspaceId, role, agentTokenId }: { userId: string; workspaceId: string; role: Role; agentTokenId?: string }
) {
  try {
    const input = await parseJson(request, ClusterCreateSchema);
    const cluster = await createCluster(
      { name: input.name, description: input.description },
      { userId, workspaceId, role, source: agentTokenId ? "agent" : "user" }
    );
    return NextResponse.json(cluster, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
