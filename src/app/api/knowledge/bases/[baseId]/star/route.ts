import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  starBase,
  unstarBase,
} from "@/features/knowledge/server/service";

/**
 * `PUT|DELETE /api/knowledge/bases/{baseId}/star` — the caller's OWN star. A favourite, not a
 * workspace property: nothing writes to the base row, and two members see different results.
 *
 * ⚠ TWO IDEMPOTENT VERBS, NOT ONE TOGGLE. A toggle's outcome depends on state the client cannot
 * see at send time, so a retry after a timeout that actually landed silently un-does the write.
 * The optimistic client (`client/hooks.ts › useToggleBaseStar`) picks the direction from cache,
 * which is also what makes its rollback exact.
 *
 * ⚠ THE USER ID IS NEVER IN THE REQUEST — it comes off the auth wrapper into `KnowledgeContext`
 * and the service takes no user parameter, so no shape stars something for somebody else.
 *
 * `minRole` stays at the wrapper's default (`viewer`): a personal bookmark on a base the caller
 * can already read, writing to their own row.
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function handlePut(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    // Visibility-gated in the service: a foreign or hidden base 404s rather than becoming a star.
    await starBase(ctx, requireBaseId(auth));
    return NextResponse.json({ starred: true });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    // ⚠ NOT visibility-gated (`service-stars.ts › unstarBase`): dropping one's own row must never
    // be refused by a change to what the base is.
    await unstarBase(ctx, requireBaseId(auth));
    return NextResponse.json({ starred: false });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const PUT = withWorkspaceAuth(handlePut);
export const DELETE = withWorkspaceAuth(handleDelete);
