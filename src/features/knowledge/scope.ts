import type { KnowledgeBase } from "./types";

/**
 * Sharing scope derived from two storage columns:
 *   private   → visibility 'private'
 *   team      → visibility 'public' + access_mode 'teams'
 *   workspace → visibility 'public' + access_mode 'workspace'
 * Pure derivation, no IO — client + server safe.
 */
export type KbScope = "private" | "team" | "workspace";

export function kbScope(
  base: Pick<KnowledgeBase, "visibility" | "accessMode">
): KbScope {
  if (base.visibility === "private") return "private";
  return base.accessMode === "teams" ? "team" : "workspace";
}

/** ⚠ `workspace` reads "Public" to match MCP vocabulary (`dopl_kb`
 *  `op="set_visibility"` takes `visibility="public"`). Storage/wire spelling
 *  stays `workspace`. */
export const KB_SCOPE_LABEL: Record<KbScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Public",
};
