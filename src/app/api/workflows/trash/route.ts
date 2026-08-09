import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { listTrash } from "@/features/workflows/server/service";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

function toErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("api/workflows/trash", err);
}

async function handleGet(
  _request: NextRequest,
  {
    userId,
    workspaceId,
    role,
    agentTokenId,
  }: { userId: string; workspaceId: string; role: Role; agentTokenId?: string }
) {
  try {
    const workflows = await listTrash({
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

export const GET = withWorkspaceAuth(handleGet);
