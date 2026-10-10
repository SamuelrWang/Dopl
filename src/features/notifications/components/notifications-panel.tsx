"use client";

import { useEffect, useRef, useState } from "react";
import { Switch } from "@/shared/ui/switch";
import { toast } from "@/shared/ui/toast";
import { SettingRow } from "@/features/channels/components/settings-agent-rows";
import { VISIBLE_NOTIFICATION_EVENTS, type NotificationEventId } from "../registry";
import type { NotificationPrefs, NotificationPrefsStore } from "../prefs";

/**
 * THE NOTIFICATIONS TAB'S ROWS — one per registry event, a name and a switch (the Configuration
 * tab's row recipe, `SettingRow`, so the two panes read as one vocabulary).
 *
 * ⚠ IT KNOWS NO BACKEND. The binding hands it a {@link NotificationPrefsStore}; this file only
 * loads, flips and writes the whole record through it.
 * ⚠ ONE ROW PER *WIRED* EVENT, not per registered id. The registry names events nothing raises
 * yet (`wired: false`); drawing a switch for one would be a control that does nothing, so
 * `VISIBLE_NOTIFICATION_EVENTS` is the list and the record still carries every id.
 * ⚠ OPTIMISTIC WITH REVERT: a switch never claims a state the store did not take (the
 * `use-orchestrator-launch.ts` idiom).
 */
export function NotificationsPanel({ store }: { store: NotificationPrefsStore }) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The last record the store confirmed: what a refused write reverts to.
  const confirmed = useRef<NotificationPrefs | null>(null);

  useEffect(() => {
    let live = true;
    store
      .load()
      .then((p) => {
        if (!live) return;
        confirmed.current = p;
        setPrefs(p);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [store]);

  async function flip(id: NotificationEventId, on: boolean) {
    if (!prefs) return;
    const next: NotificationPrefs = { ...prefs, events: { ...prefs.events, [id]: on } };
    setPrefs(next);
    setBusy(true);
    let saved: NotificationPrefs | null = null;
    try {
      saved = await store.save(next);
    } catch {
      saved = null;
    }
    setBusy(false);
    if (saved) {
      confirmed.current = saved;
      setPrefs(saved);
    } else {
      setPrefs(confirmed.current);
      toast({ title: "Couldn't save", description: "Your notification setting was not changed." });
    }
  }

  if (failed) {
    return <p className="text-caption text-text-muted">Could not load your settings.</p>;
  }
  if (!prefs) return null;

  return (
    <div className="flex flex-col gap-1">
      {VISIBLE_NOTIFICATION_EVENTS.map((event) => (
        <SettingRow key={event.id} name={event.label}>
          <Switch
            checked={event.locked ? true : prefs.events[event.id]}
            disabled={busy || event.locked}
            onChange={(on) => void flip(event.id, on)}
            aria-label={event.label}
          />
        </SettingRow>
      ))}
    </div>
  );
}
