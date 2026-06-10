import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { listEdges, insertEdge } from "@/features/canvas/server/edges";

const EdgeCreateSchema = z.object({
  id: z.string().uuid(),
  fromPanelId: z.string().min(1).max(64),
  toPanelId: z.string().min(1).max(64),
});

async function handleGet(
  _request: NextRequest,
  { workspaceId }: { workspaceId: string }
) {
  try {
    const edges = await listEdges(workspaceId);
    return NextResponse.json({ edges });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

async function handlePost(
  request: NextRequest,
  { userId, workspaceId }: { userId: string; workspaceId: string }
) {
  try {
    const input = await parseJson(request, EdgeCreateSchema);
    if (input.fromPanelId === input.toPanelId) {
      return NextResponse.json(
        { error: { code: "INVALID_EDGE", message: "Self-edges not allowed" } },
        { status: 400 }
      );
    }
    await insertEdge(workspaceId, userId, {
      id: input.id,
      fromPanelId: input.fromPanelId,
      toPanelId: input.toPanelId,
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
