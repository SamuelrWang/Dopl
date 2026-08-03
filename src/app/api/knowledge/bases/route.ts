import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { toKnowledgeErrorResponse } from "@/shared/api/knowledge-route";
import {
  buildKnowledgeContext,
  createBase,
  listBaseOwnerNames,
  listBases,
} from "@/features/knowledge/server/service";
import { KnowledgeBaseCreateSchema } from "@/features/knowledge/schema";

/**
 * GET /api/knowledge/bases — the caller's visible bases, plus
 * `ownerNames`: display names for the bases created by *other* members,
 * keyed by user id (list-pane attribution). Folded in here rather than
 * given its own endpoint because the two reads are never useful apart —
 * the owner-name lookup takes the base list as its input, so a separate
 * route would mean a second round trip that can only ever follow this
 * one (this is exactly the chain `knowledge/page.tsx:50-51` runs).
 *
 * `ownerNames` is `{}` when every base is the caller's own (the common
 * solo case skips the profiles query entirely). Additive — existing
 * clients read `bases` and ignore it.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildKnowledgeContext(auth);
    const bases = await listBases(ctx);
    const ownerNames = await listBaseOwnerNames(ctx, bases);
    return NextResponse.json({ bases, ownerNames });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, KnowledgeBaseCreateSchema);
    const ctx = buildKnowledgeContext(auth);
    const base = await createBase(ctx, input);
    return NextResponse.json({ base }, { status: 201 });
  } catch (err) {
    return toKnowledgeErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost, { minRole: "member" });
