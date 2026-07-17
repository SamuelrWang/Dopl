import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { resolveExportWorkspace } from "@/shared/auth/export-workspace";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, getSkillBySlug, listFiles } from "@/features/skills/server/service";

/**
 * GET /api/skills/[skillSlug]/export — download the skill as a zip in
 * the standard agent-skills layout: `<slug>/SKILL.md` + supplementary
 * files alongside. Compatible with Claude Code's skills directory.
 *
 * A plain download link can't send X-Workspace-Id, so `?workspaceId=` scopes
 * the export to a non-default workspace (membership-checked in the helper).
 */
export const GET = withWorkspaceAuth(async (request, auth) => {
  try {
    const { workspaceId, role } = await resolveExportWorkspace(request, auth);
    const ctx = buildSkillContext({ ...auth, workspaceId, role });
    const slug = requireSkillSlug(auth.params);
    const skill = await getSkillBySlug(ctx, slug);
    const files = await listFiles(ctx, slug);

    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
      entries[`${skill.slug}/${file.name}`] = strToU8(file.body);
    }
    const zip = zipSync(entries);

    return new NextResponse(Buffer.from(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${skill.slug}-skill.zip"`,
      },
    });
  } catch (err) {
    return toSkillErrorResponse(err);
  }
});
