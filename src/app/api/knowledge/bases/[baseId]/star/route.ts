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
 * `PUT|DELETE /api/knowledge/bases/{baseId}/star` — the caller's OWN star on
 * one base. A favourite, not a workspace property: nothing here writes to the
 * base row, and two members hitting this route about the same base do not see
 * each other's result.
 *
 * TWO IDEMPOTENT VERBS RATHER THAN ONE TOGGLE, deliberately. A toggle's
 * outcome depends on state the client cannot see at send time, so a retry
 * after a timeout that actually landed silently un-does the write; PUT and
 * DELETE both state the DESIRED end state, so the retry is a no-op. The
 * optimistic client (`client/hooks.ts › useToggleBaseStar`) decides the
 * direction from the cache it already has and sends that, which is also what
 * makes its rollback exact.
 *
 * THE USER ID IS NEVER IN THE REQUEST. It comes off the auth wrapper into
 * `KnowledgeContext`, and the service takes no user parameter at all — so
 * there is no shape in which this route stars something for somebody else.
 *
 * `minRole` stays at the wrapper's default (`viewer`). Starring is a personal
 * bookmark on a base the caller can already read; gating it at `member` would
 * refuse a read-only member the ability to organise their own home grid while
 * leaving them every base it sorts. The write it performs is to the caller's
 * own row, never to workspace content.
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function handlePut(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    // Visibility-gated in the service: a base in another workspace, or one the
    // private/teams gate hides, 404s here rather than becoming a star.
    await starBase(ctx, requireBaseId(auth));
    return NextResponse.json({ starred: true });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    // NOT visibility-gated — see `service-stars.ts › unstarBase`. Dropping
    // one's own row must never be refused by a change to what the base is.
    await unstarBase(ctx, requireBaseId(auth));
    return NextResponse.json({ starred: false });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const PUT = withWorkspaceAuth(handlePut);
export const DELETE = withWorkspaceAuth(handleDelete);
