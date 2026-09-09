import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  readEntry,
  restoreEntryRevision,
} from "@/features/knowledge/server/service";

/**
 * `POST /api/knowledge/entries/{entryId}/revisions/{revisionId}/restore` —
 * write a prior snapshot back.
 *
 * 🔒 **`minRole: "member"` — THE ENTRY WRITE FLOOR, the same one `PATCH
 * /api/knowledge/entries/{entryId}` carries.** A restore IS an edit; it earns
 * neither a lower floor nor a higher one.
 *
 * 🔒 ⚠ **DELIBERATELY *NOT* `sessionOnly`, AND THAT IS A DECISION RATHER THAN AN
 * OMISSION.** That gate exists for acts that DESTROY (`DELETE .../entries/{id}`
 * carries it, and the reasoning is on that route). A restore destroys nothing:
 * it appends a revision whose payload is a state that already happened, and the
 * revision it restored from is still there afterwards. Agents may therefore
 * restore, gated by `assertBaseWritable` and the base's `agent_write_enabled`
 * toggle like every other agent write.
 *
 * ⚠ THE RESPONSE IS THE RESTORED ENTRY, so the caller's cache can be patched
 * without a second read — the shape `PATCH .../entries/{id}` already answers.
 */
async function handlePost(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const entryId = auth.params?.entryId;
    const revisionId = auth.params?.revisionId;
    if (!entryId) throw HttpError.badRequest("entryId is required");
    if (!revisionId) throw HttpError.badRequest("revisionId is required");
    const ctx = buildKnowledgeContext(auth);
    await restoreEntryRevision(ctx, entryId, revisionId);
    const entry = await readEntry(ctx, entryId);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
