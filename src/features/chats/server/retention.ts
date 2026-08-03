import "server-only";
import {
  FREE_CHATS_WINDOW_DAYS,
  getWorkspaceEntitlements,
  upgradeUrl,
} from "@/features/billing/server/entitlements";
import * as repo from "./repository";

/**
 * The chats retention window is a READ filter, not a delete: free
 * workspaces show only sessions newer than `chatsWindowDays`; Pro (and
 * any full-history plan) sees everything. Nothing is ever removed — the
 * window only hides. This module resolves the window for a workspace and
 * builds the friendly "upgrade to restore full history" envelope the
 * detail route returns, mirroring billing's `entitlementDeniedBody`.
 */

/**
 * Resolved window for a workspace read. `since` is the DB-computed cutoff
 * DATE (`YYYY-MM-DD`) to feed `.gte`/`.lt session_date` filters, or `null`
 * when history is unbounded (Pro).
 */
export interface ChatsWindow {
  windowDays: number | null;
  since: string | null;
}

export async function resolveChatsWindow(
  workspaceId: string
): Promise<ChatsWindow> {
  const { chatsWindowDays } = await getWorkspaceEntitlements(workspaceId);
  if (chatsWindowDays === null) return { windowDays: null, since: null };
  const since = await repo.retentionCutoff(chatsWindowDays);
  return { windowDays: chatsWindowDays, since };
}

/**
 * Structured body for a detail read of a hidden chat. Mirrors the shape
 * of billing's `entitlementDeniedBody`: a flat `{ error, message,
 * upgrade_url }` envelope. Emphasizes that nothing is deleted — the chat
 * is safely stored, Pro restores full history.
 *
 * `upgrade_url` comes from billing's shared `upgradeUrl()` — the in-app
 * upgrade surface. The per-workspace `/{slug}/settings/billing` route does
 * not exist (404).
 */
export function chatRetentionDeniedBody() {
  return {
    error: "chat_outside_retention" as const,
    message:
      `This chat is older than the free plan's ${FREE_CHATS_WINDOW_DAYS}-day ` +
      `history window. Nothing has been deleted — it's safely stored. Upgrade ` +
      `to Pro to restore full chat history.`,
    upgrade_url: upgradeUrl(),
  };
}
