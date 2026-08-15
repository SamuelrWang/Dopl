import type { Chat } from "./types";

/**
 * Three-way sharing scope derived from the two storage columns. Same model as
 * knowledge bases (features/knowledge/scope.ts):
 *   private   → visibility 'private'                          (owner only)
 *   team      → visibility 'public' + access_mode 'teams'     (granted teams)
 *   workspace → visibility 'public' + access_mode 'workspace' (everyone)
 * Pure derivation, no IO — client + server safe.
 */
export type ChatScope = "private" | "team" | "workspace";

export function chatScope(
  chat: Pick<Chat, "visibility" | "accessMode">
): ChatScope {
  if (chat.visibility === "private") return "private";
  return chat.accessMode === "teams" ? "team" : "workspace";
}

export const CHAT_SCOPE_LABEL: Record<ChatScope, string> = {
  private: "Private",
  team: "Team",
  workspace: "Public",
};
