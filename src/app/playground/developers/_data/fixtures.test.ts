import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, DEVICE_KINDS } from "@dopl/device-contracts";
import { ALL_CALLS, callById, timelineOf } from "./activity";
import { ALL_MODELS, CATEGORIES, INTEGRATIONS, categoryOf, integrationsIn, trail } from "./catalog";
import { issuesFor } from "./issues";
import { SEED_ENDPOINTS, SEED_KEYS } from "./misc";
import { EMPTY_RULES, FIELD_DEFS, countOverrides, defaultsFor, ownValue, resolveField, seedReceives, setField, wrapLines } from "./receives";
import { ALL_DEVICES, ALL_USERS, ownedDevice, userById } from "./users";
import { modelById } from "./catalog";

describe("the device hierarchy", () => {
  it("has a category per kind group, with Home merged and empty categories kept", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(["glasses", "desktop", "phone", "vehicle", "home", "robots"]);
    expect(integrationsIn("robots")).toEqual([]);
    for (const c of CATEGORIES) expect(DEVICE_KINDS).toContain(c.kind);
  });

  it("never lists the simulator as an integration or a model", () => {
    expect(INTEGRATIONS.map((i) => i.id)).not.toContain("simulator");
    expect(ALL_MODELS.map((m) => m.id)).not.toContain("simulator");
  });

  it("every model publishes only contract capabilities", () => {
    for (const m of ALL_MODELS) for (const c of m.capabilities) expect(CAPABILITY_IDS).toContain(c);
  });

  it("names a physical device's full trail", () => {
    expect(trail("g2")).toEqual(["Glasses", "Even Realities", "G2"]);
    expect(categoryOf("macos").id).toBe("desktop");
  });
});

describe("the fixtures hang together", () => {
  it("has 25 live users and unique ids", () => {
    expect(ALL_USERS.filter((u) => u.env === "live")).toHaveLength(25);
    expect(new Set(ALL_USERS.map((u) => u.id)).size).toBe(ALL_USERS.length);
    expect(new Set(ALL_DEVICES.map((d) => d.id)).size).toBe(ALL_DEVICES.length);
    expect(new Set(ALL_CALLS.map((c) => c.id)).size).toBe(ALL_CALLS.length);
  });

  it("every device seen count fits its deliveries and simulated devices stay in Test", () => {
    for (const d of ALL_DEVICES) {
      expect(d.seen7d).toBeLessThanOrEqual(d.deliveries7d);
      if (d.simulated) expect(userById(d.userId)?.env).toBe("test");
    }
  });

  it("every call points at a user and device that exist, and a device its user owns", () => {
    for (const c of ALL_CALLS) {
      if (c.userId && c.http?.status !== 404) expect(userById(c.userId), c.id).not.toBeNull();
      if (c.deviceId) expect(ownedDevice(c.deviceId)?.userId).toBe(c.userId);
      for (const candidate of c.candidates) expect(ownedDevice(candidate.deviceId)?.userId).toBe(c.userId);
    }
  });

  it("endpoints and keys carry an environment", () => {
    expect(new Set(SEED_KEYS.map((k) => k.env))).toEqual(new Set(["live", "test"]));
    expect(new Set(SEED_ENDPOINTS.map((e) => e.env))).toEqual(new Set(["live", "test"]));
  });

  it("the stale pairing case refuses device_offline twice, then a live device takes it", () => {
    const call = callById("del_7f3a91")!;
    expect(call.candidates.filter((c) => c.verdict === "refused" && c.reason.startsWith("device_offline"))).toHaveLength(2);
    expect(call.candidates.find((c) => c.verdict === "chosen")?.deviceId).toBe(call.deviceId);
    expect(ownedDevice(call.deviceId!)?.state).toBe("online");
  });

  it("the timeline labels what cannot be known", () => {
    const steps = timelineOf(callById("del_7f3a91")!);
    expect(steps.map((s) => s.label)).toEqual(["Accepted", "Candidates", "Filters", "Chosen device", "Rules version", "Queued", "Sent", "Seen by device", "Answered", "Read by the person"]);
    expect(steps.find((s) => s.key === "read")?.state).toBe("unknowable");
  });

  it("issues group by cause and drop once resolved", () => {
    const issues = issuesFor("live");
    expect(issues.map((i) => i.id)).toEqual(["stale_pairing", "needs_relink", "overflow", "webhook_failing"]);
    const stale = ALL_DEVICES.filter((d) => d.state === "stale").map((d) => d.id);
    expect(issuesFor("live", stale).map((i) => i.id)).not.toContain("stale_pairing");
    expect(issuesFor("test")).toEqual([]);
  });
});

describe("rule layering", () => {
  const g2 = modelById("g2");

  it("resolves default, then category, then model, then segment, and names the source", () => {
    expect(resolveField("g2", EMPTY_RULES, "all", "max_chars")).toMatchObject({ value: defaultsFor(g2).max_chars, source: "Dopl default", inherited: true });
    const category = setField(EMPTY_RULES, "category", "all", "max_chars", 180);
    expect(resolveField("g2", category, "all", "max_chars")).toMatchObject({ value: 180, source: "Your project · Glasses" });
    const model = setField(category, "g2", "all", "max_chars", 150);
    expect(resolveField("g2", model, "all", "max_chars")).toMatchObject({ value: 150, source: "Your project · G2" });
    const segment = setField(model, "g2", "plan:pro", "max_chars", 120);
    expect(resolveField("g2", segment, "plan:pro", "max_chars")).toMatchObject({ value: 120, source: "Your project · plan:pro" });
    expect(resolveField("g2", segment, "all", "max_chars").value).toBe(150);
  });

  it("reset removes only the level being edited", () => {
    const rules = setField(setField(EMPTY_RULES, "category", "all", "timeout_s", 30), "g2", "all", "timeout_s", 90);
    const reset = setField(rules, "g2", "all", "timeout_s", undefined);
    expect(ownValue(reset, "g2", "all", "timeout_s")).toBeUndefined();
    expect(resolveField("g2", reset, "all", "timeout_s")).toMatchObject({ value: 30, source: "Your project · Glasses" });
    expect(countOverrides(reset)).toBe(1);
  });

  it("offers no rewrite and every field has a default", () => {
    for (const f of FIELD_DEFS) expect(defaultsFor(g2)[f.key]).toBeDefined();
    const overflow = FIELD_DEFS.find((f) => f.key === "overflow")!.options!(g2).map((o) => o.value);
    expect(overflow).toEqual(["truncate", "send_to", "callback"]);
  });

  it("seeds a Test version ahead of Live on Glasses", () => {
    const glasses = seedReceives("glasses");
    expect(glasses.test).toBeGreaterThan(glasses.live);
    expect(glasses.versions.map((v) => v.n)).toContain(glasses.live);
  });

  it("wraps on words", () => {
    expect(wrapLines("one two three", 7)).toEqual(["one two", "three"]);
  });
});
