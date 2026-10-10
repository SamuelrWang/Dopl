import { describe, expect, it } from "vitest";
import { defaultNotificationPrefs, normalizeNotificationPrefs } from "./prefs";
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_IDS } from "./registry";

describe("notification prefs", () => {
  it("defaults every event on", () => {
    const p = defaultNotificationPrefs();
    expect(Object.keys(p.events).sort()).toEqual([...NOTIFICATION_EVENT_IDS].sort());
    expect(Object.values(p.events).every(Boolean)).toBe(true);
  });

  it("reads garbage as the defaults", () => {
    for (const raw of [null, undefined, "x", [], { events: [] }, { events: "no" }]) {
      expect(normalizeNotificationPrefs(raw)).toEqual(defaultNotificationPrefs());
    }
  });

  it("keeps known booleans, drops unknown keys and non-booleans", () => {
    const p = normalizeNotificationPrefs({
      events: { mention: false, decision: "false", bogus: false },
    });
    expect(p.events.mention).toBe(false);
    expect(p.events.decision).toBe(true);
    expect("bogus" in p.events).toBe(false);
  });

  it("forces a locked event on", () => {
    const locked = NOTIFICATION_EVENTS.filter((e) => e.locked).map((e) => e.id);
    expect(locked).toEqual(["approval"]);
    expect(normalizeNotificationPrefs({ events: { approval: false } }).events.approval).toBe(true);
  });
});
