import "server-only";
import {
  FREE_CHATS_WINDOW_DAYS,
  getWorkspaceEntitlements,
  upgradeUrl,
} from "@/features/billing/server/entitlements";
import * as repo from "./repository";

/** ⚠ The retention window is a READ filter, never a delete: free workspaces
 *  see only sessions newer than `chatsWindowDays`, full-history plans see
 *  everything, and nothing is ever removed. Resolves the window and builds
 *  the upgrade envelope the detail route returns. */

/** `since` = DB-computed cutoff DATE (`YYYY-MM-DD`) for `.gte`/`.lt` on
 *  `session_date`, or null when history is unbounded. */
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

/** Denial body for a hidden chat. Flat `{ error, message, upgrade_url }`,
 *  mirroring billing's `entitlementDeniedBody`. ⚠ `upgrade_url` must come
 *  from billing's `upgradeUrl()` (`/billing`, `features/billing/url.ts`) —
 *  the per-workspace `/{slug}/settings/billing` route 404s. */
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
