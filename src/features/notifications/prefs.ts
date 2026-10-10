import {
  NOTIFICATION_EVENTS,
  isNotificationEventId,
  type NotificationEventId,
} from "./registry";

/**
 * THE OPERATOR'S NOTIFICATION PREFERENCES — one on/off per registry event, global (every
 * channel). The stored shape is the same on every backend, so a store swap moves no reader.
 *
 * ⚠ DEFAULT ON. A missing or unreadable record means "notify", because a banner nobody asked
 * to silence is recoverable and a silenced one is not noticed. A locked event is forced on at
 * every read and write, so no backend can hold it off.
 *
 * ⚠ PER-CHANNEL OVERRIDES ARE NOT IN v1. The server table (migration
 * 20261117120000_notification_preferences.sql) already carries a nullable `channel_id` so
 * they can land without a second migration.
 */
export interface NotificationPrefs {
  v: 1;
  events: Record<NotificationEventId, boolean>;
}

export function defaultNotificationPrefs(): NotificationPrefs {
  const events = {} as Record<NotificationEventId, boolean>;
  for (const e of NOTIFICATION_EVENTS) events[e.id] = true;
  return { v: 1, events };
}

/** Tolerant read: unknown keys dropped, non-boolean values read as the default. */
export function normalizeNotificationPrefs(raw: unknown): NotificationPrefs {
  const out = defaultNotificationPrefs();
  const events =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { events?: unknown }).events
      : undefined;
  if (events && typeof events === "object" && !Array.isArray(events)) {
    for (const [key, value] of Object.entries(events)) {
      if (isNotificationEventId(key) && typeof value === "boolean") out.events[key] = value;
    }
  }
  for (const e of NOTIFICATION_EVENTS) if (e.locked) out.events[e.id] = true;
  return out;
}

/**
 * WHERE THE RECORD LIVES — the seam the tab is built behind. Two backends exist:
 * `./stores/desktop-store.ts` (this Mac's local store, over the desktop bridge) and
 * `./stores/api-store.ts` (the server table, per user, every device). Which one a surface
 * mounts is the binding's decision; the panel only ever sees this interface.
 */
export interface NotificationPrefsStore {
  /** The stored record, or the defaults. Rejects only when the backend is unreachable. */
  load(): Promise<NotificationPrefs>;
  /** Writes the whole record; answers what the backend actually holds, or null on refusal. */
  save(prefs: NotificationPrefs): Promise<NotificationPrefs | null>;
}
