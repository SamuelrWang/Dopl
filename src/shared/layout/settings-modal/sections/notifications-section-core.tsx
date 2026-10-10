"use client";

import { useMemo } from "react";
// ⚠ Deep imports, NOT a barrel (the devices-section-core rule).
import { NotificationsPanel } from "@/features/notifications/components/notifications-panel";
import {
  desktopNotificationPrefsStore,
  notificationsBridge,
} from "@/features/notifications/stores/desktop-store";
import { SectionShell } from "./section-shell";

/**
 * NOTIFICATIONS (2026-10-09, KB dopl-development "Notifications Audit 2026-10-08") — which
 * events raise a banner. v1 binds THIS MAC'S store: the banners are the desktop's, and the
 * server table is written but not applied. Swapping to `stores/api-store.ts` is the one-line
 * change once it is.
 * ⚠ No bridge, no rows (INVARIANTS §5): the binding only mounts this pane when one exists.
 */
export function NotificationsSectionCore() {
  const bridge = notificationsBridge();
  const store = useMemo(() => (bridge ? desktopNotificationPrefsStore(bridge) : null), [bridge]);
  return (
    <SectionShell title="Notifications" subtitle="Alerts on this computer.">
      {store ? <NotificationsPanel store={store} /> : null}
    </SectionShell>
  );
}

/** True when this renderer can store notification settings: the binding's mount predicate. */
export function canShowNotificationsSection(): boolean {
  return notificationsBridge() !== null;
}
