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

/**
 * The word a HUMAN reads for each level. `workspace` reads "Public" —
 * the same vocabulary the MCP surface already uses (`dopl_kb`
 * `op="set_visibility"` takes `visibility="public"`). The storage/wire
 * spelling stays `workspace`; only the label converged.
 */
export const KB_SCOPE_LABEL: Record<KbScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Public",
};
