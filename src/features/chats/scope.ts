import type { Chat } from "./types";

/**
 * Three-way sharing scope derived from the two storage columns —
 * the exact model knowledge bases use (see features/knowledge/scope.ts):
 *
 *   private   → visibility 'private'  (owner only)
 *   team      → visibility 'public' + access_mode 'teams' (granted teams)
 *   workspace → visibility 'public' + access_mode 'workspace' (everyone)
 *
 * Client + server safe — pure derivation, no IO.
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
