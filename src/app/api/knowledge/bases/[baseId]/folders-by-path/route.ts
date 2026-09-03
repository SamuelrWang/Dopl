import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { DESCRIPTION_MAX } from "@/config";
import { HttpError } from "@/shared/lib/http-error";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createFolderByPath,
  deleteByPath,
  listDirByPath,
} from "@/features/knowledge/server/service";

/**
 * Path-based folder ops: POST `{path}` → mkdir -p (idempotent); GET `?path=` → immediate
 * children; DELETE `?path=` → soft-delete the folder OR entry the path resolves to.
 */

function requireBaseId(auth: WorkspaceAuthContext): string {
  const id = auth.params?.baseId;
  if (!id) throw HttpError.badRequest("baseId is required");
  return id;
}

const CreateFolderSchema = z.object({
  path: z.string().min(1),
  // mkdir -p is idempotent, so a re-call with a description updates the leaf folder's summary.
  description: z.string().max(DESCRIPTION_MAX).nullable().optional(),
});

async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const path = request.nextUrl.searchParams.get("path") ?? "";
    const ctx = buildKnowledgeContext(auth);
    const listing = await listDirByPath(ctx, baseId, path);
    return NextResponse.json(listing);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const input = await parseJson(request, CreateFolderSchema);
    const ctx = buildKnowledgeContext(auth);
    const folder = await createFolderByPath(ctx, baseId, input.path, input.description);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handleDelete(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const baseId = requireBaseId(auth);
    const path = request.nextUrl.searchParams.get("path");
    if (path === null) {
      throw HttpError.badRequest("path query parameter is required");
    }
    const ctx = buildKnowledgeContext(auth);
    const result = await deleteByPath(ctx, baseId, path);
    return NextResponse.json(result);
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
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
