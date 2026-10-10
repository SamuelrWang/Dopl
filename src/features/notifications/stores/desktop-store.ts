"use client";

import { getSpaBridge, type SpaBridgeSurface } from "@/shared/lib/spa-bridge";
import {
  normalizeNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from "../prefs";

type NotificationsBridge = NonNullable<SpaBridgeSurface["notifications"]>;

/**
 * The desktop bridge's notifications pair, else null. ⚠ CAPABILITY-KEYED: both members are
 * probed, because a main older than these ops has a `window.dopl` with everything but them, and
 * a row that can read but not write is worse than no row (`use-orchestrator-launch.ts`).
 */
export function notificationsBridge(): NotificationsBridge | null {
  const n = getSpaBridge()?.notifications;
  return n && typeof n.get === "function" && typeof n.set === "function" ? n : null;
}

/**
 * THIS MAC'S BACKEND — main's electron-store (`main/notification-prefs.js`), which is also what
 * the banner gate reads, in process. Per machine: another computer keeps its own record.
 */
export function desktopNotificationPrefsStore(
  bridge: NotificationsBridge
): NotificationPrefsStore {
  return {
    async load() {
      return normalizeNotificationPrefs(await bridge.get());
    },
    async save(prefs: NotificationPrefs) {
      const res = await bridge.set(prefs);
      return res && res.ok ? normalizeNotificationPrefs(res.prefs) : null;
    },
  };
}
