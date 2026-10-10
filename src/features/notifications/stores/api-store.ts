"use client";

import { apiRequest } from "@/shared/api/api-client";
import {
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "../prefs";

export const NOTIFICATION_PREFS_PATH = "/api/user/notification-preferences";

/**
 * THE SERVER BACKEND — one record per user, every device. ⚠ NOT MOUNTED BY ANY BINDING YET:
 * its table is migration 20261117120000_notification_preferences.sql, written but not applied
 * (pending Samuel's call, 2026-10-09). Swapping a binding to this store is the whole change once
 * it is applied; the desktop banner gate would then read the same route.
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
