"use client";

import { apiRequest } from "@/shared/api/api-client";
import {
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "../prefs";

export const NOTIFICATION_PREFS_PATH = "/api/user/notification-preferences";

/**
 * THE SERVER BACKEND, AND THE ONLY ONE — one record per user, honored on every device. MOUNTED
 * by `settings-modal/sections/notifications-section-core.tsx`; the desktop's banner gate reads
 * this same route through a short cache (`dopl-desktop-app/main/notification-prefs.js`).
 *
 * ⚠ ITS TABLE IS NOT APPLIED YET (migration 20261117120000, Samuel's call). Until it is, the
 * route answers 503 and `load` rejects, which the panel shows as "could not load" — and every
 * banner keeps showing, because the gate defaults ON. Nothing is stored and nothing is silenced.
 */
export function apiNotificationPrefsStore(): NotificationPrefsStore {
  return {
    async load() {
      const body = await apiRequest<{ prefs: unknown }>(NOTIFICATION_PREFS_PATH);
      return normalizeNotificationPrefs(body?.prefs);
    },
    async save(prefs: NotificationPrefs) {
      try {
        const body = await apiRequest<{ prefs: unknown }>(NOTIFICATION_PREFS_PATH, {
          method: "PUT",
          body: { prefs },
        });
        return normalizeNotificationPrefs(body?.prefs);
      } catch {
        return null;
      }
    },
  };
}
