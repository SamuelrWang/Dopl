import type { KnowledgeBase } from "./types";

/**
 * Three-way sharing scope derived from the two storage columns:
 *
 *   private   → visibility 'private'  (owner + admins via settings only)
 *   team      → visibility 'public' + access_mode 'teams' (granted teams)
 *   workspace → visibility 'public' + access_mode 'workspace' (everyone)
 *
 * Client + server safe — pure derivation, no IO.
 */
export type KbScope = "private" | "team" | "workspace";

export function kbScope(
  base: Pick<KnowledgeBase, "visibility" | "accessMode">
): KbScope {
  if (base.visibility === "private") return "private";
  return base.accessMode === "teams" ? "team" : "workspace";
}

export const KB_SCOPE_LABEL: Record<KbScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Workspace",
};
