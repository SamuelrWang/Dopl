import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import {
  createWorkflow,
  listWorkflows,
} from "@/features/workflows/server/service";
import { DESCRIPTION_MAX } from "@/config";
import { WorkflowNameSchema } from "@/features/workflows/schema";

const WorkflowCreateSchema = z.object({
  id: z.string().uuid().optional(),
  name: WorkflowNameSchema,
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
  clusterId: z.string().uuid().nullable().optional(),
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
    const workflows = await listWorkflows({
      userId,
      workspaceId,
      role,
      source: agentTokenId ? "agent" : "user",
    });
    return NextResponse.json({ workflows });
  } catch (err) {
    return toErrorResponse(err);
  }
}

async function handlePost(
  request: NextRequest,
  { userId, workspaceId, role, agentTokenId }: { userId: string; workspaceId: string; role: Role; agentTokenId?: string }
) {
  try {
    const input = await parseJson(request, WorkflowCreateSchema);
    const workflow = await createWorkflow(input, {
      userId,
      workspaceId,
      role,
      source: agentTokenId ? "agent" : "user",
    });
    return NextResponse.json(workflow, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
