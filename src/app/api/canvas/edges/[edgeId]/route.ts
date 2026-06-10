import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { deleteEdge } from "@/features/canvas/server/edges";

async function handleDelete(
  _request: NextRequest,
  {
    workspaceId,
    params,
  }: { workspaceId: string; params?: Record<string, string> }
) {
  try {
    const edgeId = params?.edgeId;
    if (!edgeId) {
      return NextResponse.json(
        { error: { code: "MISSING_PARAM", message: "edgeId required" } },
        { status: 400 }
      );
    }
    await deleteEdge(workspaceId, edgeId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
