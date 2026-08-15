import type { Skill } from "./types";

/**
 * Three-way sharing scope derived from the two storage columns. Same model as
 * knowledge bases and chats:
 *   private   → visibility 'private'                          (owner only)
 *   team      → visibility 'public' + access_mode 'teams'     (granted teams)
 *   workspace → visibility 'public' + access_mode 'workspace' (everyone)
 * Pure derivation, no IO — client + server safe.
 */
export type SkillScope = "private" | "team" | "workspace";

export function skillScope(
  skill: Pick<Skill, "visibility" | "accessMode">
): SkillScope {
  if (skill.visibility === "private") return "private";
  return skill.accessMode === "teams" ? "team" : "workspace";
}

export const SKILL_SCOPE_LABEL: Record<SkillScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Public",
};
