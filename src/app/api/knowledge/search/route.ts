import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { buildKnowledgeContext } from "@/features/knowledge/server/service";
import { searchKnowledgeEntries } from "@/features/knowledge/server/search";

/**
 * Full-text search across the workspace's knowledge entries.
 *
 *   GET /api/knowledge/search?q=...&base=<slug>&limit=20
 *
 * `base` is optional — when omitted, searches across the whole
 * workspace. `limit` defaults to 20, capped at 100 by the RPC.
 */

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const url = request.nextUrl;
    const q = url.searchParams.get("q") ?? "";
    const base = url.searchParams.get("base") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const ctx = buildKnowledgeContext(auth);
    const hits = await searchKnowledgeEntries(ctx, q, {
      baseSlug: base,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ hits });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
