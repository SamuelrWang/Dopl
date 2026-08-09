import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@/features/workspaces/types";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { createCluster, listClusters } from "@/features/clusters/server/service";
import { DESCRIPTION_MAX } from "@/config";
import { ClusterNameSchema } from "@/features/clusters/schema";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

const ClusterCreateSchema = z.object({
  name: ClusterNameSchema,
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
});

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/clusters", err);
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
