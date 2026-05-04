import "server-only";
import {
  listSkillsForWorkspace,
  findSkillBySlug,
  findSkillById,
  listFilesForSkill,
  findFileByName,
} from "@/features/skills/server/repository";
import type { ToolResult } from "./types";

/**
 * Workspace-shared skills reads exposed to the private chat.
 *
 * Visibility: skills with `visibility='private'` are only readable when
 * `created_by` matches the calling user. Mirrors the KB rules.
 */

export interface SkillsScopeFilters {
  skillIds?: string[];
}

function visibleSkills<T extends { id: string; visibility: "public" | "private"; createdBy: string | null }>(
  skills: T[],
  userId: string,
  skillIds?: string[]
) {
  return skills.filter((s) => {
    if (skillIds && skillIds.length > 0 && !skillIds.includes(s.id)) return false;
    if (s.visibility === "private" && s.createdBy !== userId) return false;
    return true;
  });
}

/** Tool: list_workspace_skills. */
export async function executeListWorkspaceSkills(
  _input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: SkillsScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const all = await listSkillsForWorkspace(workspaceId);
  const visible = visibleSkills(all, userId, scopeFilters?.skillIds);
  return {
    result: JSON.stringify({
      skills: visible.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        when_to_use: s.whenToUse,
        when_not_to_use: s.whenNotToUse,
        status: s.status,
        visibility: s.visibility,
      })),
    }),
  };
}

/**
 * Tool: read_skill_file — return one skill's file body. Defaults to the
 * primary `SKILL.md` if no file_name is given.
 */
export async function executeReadSkillFile(
  input: Record<string, unknown>,
  userId?: string,
  _canvasContext?: unknown,
  workspaceId?: string,
  scopeFilters?: SkillsScopeFilters
): Promise<ToolResult> {
  if (!userId || !workspaceId) {
    return { result: JSON.stringify({ error: "Not authenticated." }) };
  }
  const idInput = (input.skill_id as string) || undefined;
  const slugInput = (input.skill_slug as string) || undefined;
  const fileName = ((input.file_name as string) || "SKILL.md").trim();
  if (!idInput && !slugInput) {
    return {
      result: JSON.stringify({
        error: "Provide skill_id or skill_slug.",
      }),
    };
  }

  const skill = idInput
    ? await findSkillById(workspaceId, idInput)
    : await findSkillBySlug(workspaceId, slugInput!);
  if (!skill) {
    return { result: JSON.stringify({ error: "Skill not found." }) };
  }
  if (
    scopeFilters?.skillIds &&
    scopeFilters.skillIds.length > 0 &&
    !scopeFilters.skillIds.includes(skill.id)
  ) {
    return { result: JSON.stringify({ error: "Skill not in current scope." }) };
  }
  if (skill.visibility === "private" && skill.createdBy !== userId) {
    return { result: JSON.stringify({ error: "Skill not visible." }) };
  }

  const file = await findFileByName(skill.id, fileName);
  if (!file) {
    // Surface the available file names so the model can retry with a
    // valid one rather than guessing.
    const all = await listFilesForSkill(skill.id, { includeBody: false });
    return {
      result: JSON.stringify({
        error: `File '${fileName}' not found in skill.`,
        available_files: all.map((f) => f.name),
      }),
    };
  }
  return {
    result: JSON.stringify({
      skill: {
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
      },
      file: {
        name: file.name,
        body: file.body,
        updated_at: file.updatedAt,
      },
    }),
  };
}
