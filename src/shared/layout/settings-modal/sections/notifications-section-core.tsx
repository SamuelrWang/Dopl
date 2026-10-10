"use client";

import { useMemo } from "react";
// ⚠ Deep imports, NOT a barrel (the devices-section-core rule).
import { NotificationsPanel } from "@/features/notifications/components/notifications-panel";
import { apiNotificationPrefsStore } from "@/features/notifications/stores/api-store";
import { refreshDesktopBannerGate } from "@/features/notifications/stores/desktop-gate";
import type { NotificationPrefsStore } from "@/features/notifications/prefs";
import { SectionShell } from "./section-shell";

/**
 * NOTIFICATIONS (2026-10-09, KB dopl-development "Notifications Audit 2026-10-08") — which
 * events raise a banner.
 *
 * ⚠ THE RECORD IS THE ACCOUNT'S, NOT THIS MAC'S (Samuel, 2026-10-09). It is stored server-side
 * (`stores/api-store.ts` → `/api/user/notification-preferences`), so one answer governs every
 * computer the operator signs in on. There is NO local copy and nothing to migrate: the local
 * store existed for one afternoon in a build that never shipped.
 *
 * ⚠ SO THERE IS NO MOUNT PREDICATE ANY MORE. The old pane needed the desktop bridge to reach
 * this Mac's store; this one needs only the signed-in session every settings surface already
 * has. `canShowNotificationsSection` stays as the binding's seam, and answers true.
 */
export function NotificationsSectionCore() {
  // ⚠ STABLE IDENTITY. The panel reloads on a new `store` reference, so this is built once per
  // mount and not per render.
  const store = useMemo<NotificationPrefsStore>(() => {
    const api = apiNotificationPrefsStore();
    return {
      load: api.load,
      async save(prefs) {
        const saved = await api.save(prefs);
        // The desktop's banner gate answers from a short cache of this same record; poke it so a
        // switch flipped here lands on the NEXT banner instead of after its TTL. Best-effort,
        // after the save has already succeeded, and a no-op on web.
        if (saved) refreshDesktopBannerGate();
        return saved;
      },
    };
  }, []);
  return (
    <SectionShell title="Notifications" subtitle="Alerts on every computer you sign in on.">
      <NotificationsPanel store={store} />
    </SectionShell>
  );
}

/** The binding's mount seam. The account record needs no desktop bridge, so: always. */
export function canShowNotificationsSection(): boolean {
  return true;
}
