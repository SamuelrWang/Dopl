import { describe, expect, it } from "vitest";
import { defaultNotificationPrefs, normalizeNotificationPrefs } from "./prefs";
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_IDS } from "./registry";

describe("notification prefs", () => {
  it("carries every registered id, and defaults each to its registry default", () => {
    const p = defaultNotificationPrefs();
    // The record spans the whole DOMAIN, not just the rows the panel draws.
    expect(Object.keys(p.events).sort()).toEqual([...NOTIFICATION_EVENT_IDS].sort());
    for (const e of NOTIFICATION_EVENTS) {
      expect(p.events[e.id]).toBe(e.defaultOn !== false);
    }
    // Fail-ON is the rule; `defaultOn: false` is the ruled exception (today: DMs only).
    const off = NOTIFICATION_EVENTS.filter((e) => e.defaultOn === false).map((e) => e.id);
    expect(off).toEqual(["direct_message"]);
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

  it("forces every locked event on, whatever the record says", () => {
    const locked = NOTIFICATION_EVENTS.filter((e) => e.locked).map((e) => e.id);
    // Approvals plus the four SAFETY events Samuel kept at #2775.
    expect(locked).toEqual([
      "approval",
      "signed_out",
      "credits_exhausted",
      "runtime_signin",
      "decision_failed",
    ]);
    const allOff = Object.fromEntries(locked.map((id) => [id, false]));
    const p = normalizeNotificationPrefs({ events: allOff });
    for (const id of locked) expect(p.events[id]).toBe(true);
  });
});
