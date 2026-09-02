import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  getBaseById,
  deleteBase,
  updateBase,
} from "@/features/knowledge/server/service";
import { KnowledgeBaseUpdateSchema } from "@/features/knowledge/schema";

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const base = await getBaseById(ctx, requireBaseId(auth));
    return NextResponse.json({ base });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireBaseId(auth);
    const patch = await parseJson(request, KnowledgeBaseUpdateSchema);
    const ctx = buildKnowledgeContext(auth);
    const expectedUpdatedAt = request.headers.get("x-updated-at") ?? undefined;
    const base = await updateBase(ctx, id, patch, expectedUpdatedAt);
    return NextResponse.json({ base });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const id = requireBaseId(auth);
    const ctx = buildKnowledgeContext(auth);
    await deleteBase(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
// 🔒 `sessionOnly` (2026-09-02). `dopl_kb_admin` op="delete_base" advertises this deletion as
// APP-ONLY — "there is no MCP path to it, for any role or token" — and
// `packages/mcp-server/src/gating.ts › opRefusal` was the ONLY thing enforcing
// that sentence. A `full`-profile session has Bash and its own `dopl_at_*`
// bearer, so it reached THIS route over loopback and deleted the row the
// refusal had just declined: a prompt is not a fence. ⚠ Per-METHOD — the reads
// and the PATCH stay ungated, because editing and rewriting are exactly what
// `delete-policy.ts › DELETE_REFUSAL` redirects an agent to instead.
// Full reasoning: `src/shared/auth/write-gate-coverage.test.ts`.
export const DELETE = withWorkspaceAuth(handleDelete, {
  minRole: "member",
  sessionOnly: true,
});
