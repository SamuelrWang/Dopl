import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  purgeTrashOlderThan,
} from "@/features/knowledge/server/service";

const PurgeSchema = z.object({
  beforeIso: z
    .string()
    .datetime({ message: "beforeIso must be an ISO 8601 timestamp" }),
});

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const { beforeIso } = await parseJson(request, PurgeSchema);
    const ctx = buildKnowledgeContext(auth);
    const result = await purgeTrashOlderThan(ctx, beforeIso);
    return NextResponse.json(result);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

// Admin only — destructive, can't be undone.
export const POST = withWorkspaceAuth(handlePost, { minRole: "admin" });
