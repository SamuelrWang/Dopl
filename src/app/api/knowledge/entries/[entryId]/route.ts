import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getEntry,
  deleteEntry,
  updateEntry,
} from "@/features/knowledge/server/service";
import { KnowledgeEntryUpdateSchema } from "@/features/knowledge/schema";

function requireEntryId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.entryId;
  if (!id) throw HttpError.badRequest("entryId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const entry = await getEntry(ctx, requireEntryId(auth));
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireEntryId(auth);
    const patch = await parseJson(request, KnowledgeEntryUpdateSchema);
    // Optional `X-Updated-At` precondition. Mismatch → 412 KNOWLEDGE_STALE_VERSION.
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const ctx = buildKnowledgeContext(auth);
    const entry = await updateEntry(ctx, id, patch, expectedUpdatedAt);
    return NextResponse.json({ entry });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireEntryId(auth);
    const ctx = buildKnowledgeContext(auth);
    await deleteEntry(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
// 🔒 `sessionOnly` (2026-09-02). `dopl_kb` advertises this deletion as
// APP-ONLY — "there is no MCP path to it, for any role or token" — and
// `packages/mcp-server/src/gating.ts › opRefusal` was the ONLY thing enforcing
// that sentence. A `full`-profile session has Bash and its own `dopl_at_*`
// bearer, so it reached THIS route over loopback and deleted the row the
// refusal had just declined: a prompt is not a fence. ⚠ AND THIS GATE IS NOW
// THE WHOLE FENCE: the `_admin` tool that carried the refusal was deleted once
// this landed, so removing `sessionOnly` here removes the RULE, not a second
// copy of it. ⚠ Per-METHOD — the reads and the PATCH stay ungated, because
// editing and rewriting are exactly what `delete-policy.ts › DELETE_REFUSAL`
// redirects an agent to instead.
// Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});
