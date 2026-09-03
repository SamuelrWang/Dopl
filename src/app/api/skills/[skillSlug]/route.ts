import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import {
  buildSkillContext,
  deleteSkill,
  resolveSkillBody,
  updateSkill,
} from "@/features/skills/server/service";
import {
  SkillUpdateSchema,
} from "@/features/skills/schema";

async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    const resolved = await resolveSkillBody(ctx, slug);
    return NextResponse.json(resolved);
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handlePatch(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    const patch = await parseJson(request, SkillUpdateSchema);
    // Precondition; mismatch → 412 SKILL_STALE_VERSION. ⚠ Client must surface conflict
    // resolution, not retry blindly.
    const expectedUpdatedAt =
      request.headers.get("x-updated-at") ?? undefined;
    const skill = await updateSkill(ctx, slug, patch, expectedUpdatedAt);
    return NextResponse.json({ skill });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const ctx = buildSkillContext(auth);
    const slug = requireSkillSlug(auth.params);
    await deleteSkill(ctx, slug);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const PATCH = withWorkspaceAuth(handlePatch, { minRole: "member" });
// 🔒 `sessionOnly` (2026-09-02). `dopl_skill` advertises this deletion as
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
