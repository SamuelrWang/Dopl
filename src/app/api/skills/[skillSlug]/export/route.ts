import { NextResponse } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { requireSkillSlug, toSkillErrorResponse } from "@/shared/api/skill-route";
import { buildSkillContext, getSkillBySlug, listFiles } from "@/features/skills/server/service";

/**
 * GET — the skill as a zip in the standard agent-skills layout (`<slug>/SKILL.md` +
 * supplementary files); compatible with Claude Code's skills directory.
 * ⚠ A plain download link cannot send X-Workspace-Id, so `workspaceIdFromQuery` lets the wrapper
 * resolve `?workspaceId=` at the header's priority (membership-checked).
 */
export const GET = withWorkspaceAuth(async (_request, auth) => {
  try {
    const ctx = buildSkillContext(auth);
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
}, { workspaceIdFromQuery: true });
