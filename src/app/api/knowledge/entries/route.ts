import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  resolveEntryRefs,
} from "@/features/knowledge/server/service";

const MAX_IDS = 100;

/** `?ids=<comma-separated>` → deduped id list. Empty/absent → no ids (service returns `[]`).
 *  ⚠ Over `MAX_IDS` is a 400, never a silent truncation. */
function parseIds(url: URL): string[] {
  const raw = url.searchParams.get("ids");
  if (!raw) return [];
  const ids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length > MAX_IDS) {
    throw HttpError.badRequest(`ids is capped at ${MAX_IDS} per request`);
  }
  return ids;
}

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ids = parseIds(request.nextUrl);
    const ctx = buildKnowledgeContext(auth);
    const entries = await resolveEntryRefs(ctx, ids);
    return NextResponse.json({ entries });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
