import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import type { Role } from "@/features/workspaces/types";
import { HttpError } from "@/shared/lib/http-error";
import { listTrash } from "@/features/workflows/server/service";

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
