import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import { buildKnowledgeContext, pinEntry } from "@/features/knowledge/server/service";

/**
 * `PUT|DELETE /api/knowledge/entries/{entryId}/pin` — the single-document half of
 * `bases/{baseId}/pin` (T81): one entry joins every session's startup context without its whole
 * base coming with it.
 *
 * ⚠ SAME SHAPE AS THE BASE ROUTE ON PURPOSE — two idempotent verbs stating the END STATE, a
 * `member` floor on both, and no `sessionOnly`. See that file for each argument; restating them
 * here is how the two drift.
 *
 * 🔒 THE ROUTE'S FLOOR IS NOT THE CONTENT'S FLOOR — `features/knowledge/server/service-pins.ts ›
 * pinEntry` chases the entry UP to its base through `service-entries.ts › getEntry`, which
 * answers `getBaseById`'s gates as a 404 about the ENTRY. "No such entry", "its base is invisible
 * to you" and "its base is outside your audience" are one answer (INVARIANTS §3).
 */

function requireEntryId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.entryId;
  if (!id) throw HttpError.badRequest("entryId is required");
  return id;
}

async function setPinned(auth: WorkspaceAuthContext, pinned: boolean) {
  try {
    const ctx = buildKnowledgeContext(auth);
    await pinEntry(ctx, requireEntryId(auth), pinned);
    return NextResponse.json({ pinned });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePut(_request: NextRequest, auth: WorkspaceAuthContext) {
  return setPinned(auth, true);
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  return setPinned(auth, false);
}

export const PUT = withWorkspaceAuth(handlePut, { minRole: "member" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "member" });
