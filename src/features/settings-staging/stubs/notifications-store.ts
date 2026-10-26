/**
 * STUBS of `@/features/notifications/stores/api-store › apiNotificationPrefsStore` and
 * `@/features/notifications/stores/desktop-gate › refreshDesktopBannerGate`. The record lives in
 * memory for the page's life instead of `/api/user/notification-preferences`.
 */
import {
  defaultNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "@/features/notifications/prefs";

let held: NotificationPrefs = defaultNotificationPrefs();

export function apiNotificationPrefsStore(): NotificationPrefsStore {
  return {
    async load() {
      return held;
    },
    async save(prefs) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      held = prefs;
      return held;
    },
  };
}

export function refreshDesktopBannerGate(): void {}
