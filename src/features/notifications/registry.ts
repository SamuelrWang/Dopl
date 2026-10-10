/**
 * THE NOTIFICATION EVENT REGISTRY (2026-10-09, KB dopl-development "Notifications Audit
 * 2026-10-08" › Design). One list, read by the profile popup's Notifications tab AND restated
 * by the desktop banner gate (`dopl-desktop-app/main/notification-prefs.js › EVENT_IDS`).
 *
 * ⚠ CODE CONST, NOT A TABLE. The four v1 events are SERVER-OWNED facts about a message
 * (a mention stamp, a decision card, a direct channel, an approval the operator holds), never
 * something an agent can declare. A new event is a new row here AND a new arm in the desktop's
 * `eventForMessage`, on one clock.
 *
 * ⚠ `approval` IS LOCKED ON. Every approval banner carries the ONE button that answers it
 * (`notify-action.js › buildActionNotification`: launch a peer's ask, send a drafted reply,
 * allow a held tool). Silencing it would leave the ask unanswerable from this machine, so the
 * row shows its state and cannot be switched off. Not a dead row: it states a real fact.
 */

export const NOTIFICATION_EVENT_IDS = [
  "mention",
  "decision",
  "direct_message",
  "approval",
] as const;

export type NotificationEventId = (typeof NOTIFICATION_EVENT_IDS)[number];

export interface NotificationEvent {
  id: NotificationEventId;
  /** The row name. Also the key into the settings help table. */
  label: string;
  /** True when the operator cannot turn it off (see the file header). */
  locked?: boolean;
}

export const NOTIFICATION_EVENTS: ReadonlyArray<NotificationEvent> = [
  { id: "mention", label: "Mentions and replies" },
  { id: "decision", label: "Decisions for you" },
  { id: "direct_message", label: "Direct messages" },
  { id: "approval", label: "Approvals", locked: true },
];

export function isNotificationEventId(value: unknown): value is NotificationEventId {
  return (
    typeof value === "string" &&
    (NOTIFICATION_EVENT_IDS as ReadonlyArray<string>).includes(value)
  );
}
