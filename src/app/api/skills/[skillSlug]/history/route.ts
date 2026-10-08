import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, getSkillHistory } from "@/features/skills/server/service";
import { noDerivation } from "@/shared/api/workspace-derivation";

// A skill SLUG is unique per workspace only, so it names no single container: the header decides.
const SKILL_SLUG_DERIVATION = noDerivation("skill slug is unique per workspace only");

/** GET — version metadata (no bodies) + structural events, newest first. `?limit=` caps each
 *  stream (default 100, max 500); the history panel merges them by createdAt. */
export const GET = withWorkspaceAuth(async (request: NextRequest, auth) => {
  try {
    const slug = requireSkillSlug(auth.params);
    const ctx = buildSkillContext(auth);
    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const result = await getSkillHistory(ctx, slug, {
      limit: Number.isNaN(limit) ? undefined : limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    return toSkillErrorResponse(err);
  }
}, { workspaceFromParams: SKILL_SLUG_DERIVATION });
