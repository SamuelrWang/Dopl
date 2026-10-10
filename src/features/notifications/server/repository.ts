import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  defaultNotificationPrefs,
  normalizeNotificationPrefs,
  type NotificationPrefs,
} from "../prefs";
import { NOTIFICATION_EVENTS, isNotificationEventId } from "../registry";

/**
 * SERVER BACKEND for notification preferences — table `notification_preferences`
 * (migration 20261117120000, ⚠ WRITTEN, NOT APPLIED). Service role, every query scoped to the
 * caller's own id. v1 reads and writes the GLOBAL rows only (`channel_id IS NULL`).
 *
 * ⚠ THIS MODULE IS WHERE `event_type` IS VALIDATED. The table deliberately carries no
 * enumerated CHECK (an enum there is a ceiling: 4 events named, 39 on the surface map), so the
 * registry in code is the list and this file is the only writer that can put a value in the
 * column. Both directions are filtered against `isNotificationEventId`, so an id the registry
 * does not name is never written, and an unknown row already in the table is ignored on read
 * rather than being mapped onto a switch.
 */

/** The table is not in this database yet (PostgREST's unknown-table code, and Postgres's own). */
export class NotificationPrefsUnavailable extends Error {}

const MISSING_TABLE = new Set(["PGRST205", "42P01"]);

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code && MISSING_TABLE.has(error.code)) throw new NotificationPrefsUnavailable();
  throw new Error(error.message || "notification_preferences query failed");
}

export async function readNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabaseAdmin()
    .from("notification_preferences")
    .select("event_type, enabled")
    .eq("user_id", userId)
    .is("channel_id", null);
  check(error);
  const events: Record<string, boolean> = { ...defaultNotificationPrefs().events };
  for (const row of (data ?? []) as Array<{ event_type: string; enabled: boolean }>) {
    // An id the registry no longer names (or never did) is a dead row, not a switch.
    if (!isNotificationEventId(row.event_type)) continue;
    events[row.event_type] = row.enabled;
  }
  return normalizeNotificationPrefs({ events });
}

/** Writes one global row per event (upsert on the partial unique key), then reads back. */
export async function writeNotificationPrefs(
  userId: string,
  prefs: NotificationPrefs
): Promise<NotificationPrefs> {
  const next = normalizeNotificationPrefs(prefs);
  const now = new Date().toISOString();
  const db = supabaseAdmin();
  // ⚠ Delete-then-insert, not `upsert`: PostgREST's on_conflict cannot name a PARTIAL unique
  // index. Only the caller's own global rows are touched.
  const del = await db
    .from("notification_preferences")
    .delete()
    .eq("user_id", userId)
    .is("channel_id", null);
  check(del.error);
  // The registry is the domain of `event_type` (no CHECK in the table): write ONLY ids it names.
  // `NOTIFICATION_EVENTS` is that list, so the filter is belt-and-braces against a malformed row
  // being added here later.
  const rows = NOTIFICATION_EVENTS.filter((e) => isNotificationEventId(e.id)).map((e) => ({
    user_id: userId,
    event_type: e.id,
    channel_id: null,
    enabled: next.events[e.id],
    updated_at: now,
  }));
  const ins = await db.from("notification_preferences").insert(rows);
  check(ins.error);
  return readNotificationPrefs(userId);
}
