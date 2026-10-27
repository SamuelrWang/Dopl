import { describe, expect, it } from "vitest";
import { ApiKeySchema, DeliverRequestSchema, DeviceEventRowSchema, WebhookEventNameSchema } from "@dopl/contracts/device-sdk";
import { DEMO_ACTIVITY } from "./activity";
import { CONNECT_STEPS, DEMO_SESSIONS, funnel, type ConnectSessionRow } from "./connect-sessions";
import { DEMO_ENVS, DEMO_NOW } from "./fixtures";
import { isStale, rotateKey } from "./keys";
import { buildLog, groupErrors, queryLog } from "./log";
import { createSimDevice, deliverTo, publishState } from "./simulator";
import { scopesByTier, tierOfScope } from "./connect-config";

const session = (reached: ConnectSessionRow["reached"], i: number): ConnectSessionRow => ({
  id: `ct_${i}`,
  env: "test",
  external_user_id: `u${i}`,
  adapter_id: null,
  kind: null,
  reached,
  steps: [{ step: reached, at: DEMO_NOW }],
  connection_id: null,
});

describe("Connect funnel", () => {
  it("counts each step as sessions that reached it or further, with share and drop", () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => session("started", i)),
      ...Array.from({ length: 2 }, (_, i) => session("device_chosen", 10 + i)),
      ...Array.from({ length: 4 }, (_, i) => session("connected", 20 + i)),
    ];
    const f = funnel(rows);
    expect(f.map((s) => s.count)).toEqual([10, 6, 4, 4, 4]);
    expect(f[1]).toMatchObject({ pct: 60, drop: 40 });
    expect(f[2].drop).toBeCloseTo((1 - 4 / 6) * 100);
    expect(f[4]).toMatchObject({ pct: 40, drop: 0 });
  });

  it("is empty-safe and the demo sessions narrow monotonically", () => {
    expect(funnel([]).every((s) => s.count === 0 && s.pct === 0 && s.drop === 0)).toBe(true);
    const counts = funnel(DEMO_SESSIONS.live).map((s) => s.count);
    expect(counts).toHaveLength(CONNECT_STEPS.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[4]).toBeGreaterThan(0);
  });
});

describe("unified log", () => {
  const env = "live" as const;
  const log = buildLog({ events: DEMO_ACTIVITY[env].events, webhooks: DEMO_ACTIVITY[env].webhooks, sessions: DEMO_SESSIONS[env], keys: DEMO_ENVS[env].keys });

  it("holds all four row types, newest first", () => {
    expect(new Set(log.map((r) => r.type))).toEqual(new Set(["request", "connect", "delivery", "webhook"]));
    for (let i = 1; i < log.length; i++) expect(log[i - 1].ts >= log[i].ts).toBe(true);
  });

  it("one search resolves request, action, device, user, connection, webhook and Connect ids", () => {
    const e = DEMO_ACTIVITY[env].events.find((x) => x.intent !== null && x.device_id)!;
    const req = log.find((r) => r.type === "request" && r.ids.includes(e.event_id))!;
    expect(queryLog(log, { q: req.id }).map((r) => r.type).sort()).toEqual(["delivery", "request"]);
    expect(queryLog(log, { q: `act_${e.event_id.slice(4)}` }).length).toBe(2);
    expect(queryLog(log, { q: e.device_id! }).every((r) => r.ids.includes(e.device_id!))).toBe(true);
    const w = DEMO_ACTIVITY[env].webhooks[0];
    expect(queryLog(log, { q: w.id })[0].type).toBe("webhook");
    const ct = DEMO_SESSIONS[env][0];
    expect(queryLog(log, { q: ct.id })[0].type).toBe("connect");
    expect(queryLog(log, { q: "nope_does_not_exist" })).toHaveLength(0);
  });

  it("filters by key, type and error code", () => {
    const key = DEMO_ENVS[env].keys.find((k) => k.kind === "secret")!;
    const byKey = queryLog(log, { key_id: key.id });
    expect(byKey.length).toBeGreaterThan(0);
    expect(byKey.every((r) => r.type === "request" && r.key_id === key.id)).toBe(true);
    const code = groupErrors(DEMO_ACTIVITY[env].events)[0].code;
    expect(queryLog(log, { error_code: code, type: "delivery" }).every((r) => r.error_code === code)).toBe(true);
  });

  it("groups errors by code with counts and last seen", () => {
    const groups = groupErrors(DEMO_ACTIVITY[env].events);
    const total = DEMO_ACTIVITY[env].events.filter((e) => e.error_code).length;
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(total);
    for (let i = 1; i < groups.length; i++) expect(groups[i].count).toBeLessThanOrEqual(groups[i - 1].count);
  });
});

describe("key rotation", () => {
  const keys = DEMO_ENVS.test.keys;
  const old = keys.find((k) => k.kind === "secret" && !k.revoked_at && !k.expires_at)!;

  it("adds a successor and gives the old key a 24h grace window", () => {
    const next = rotateKey(keys, old.id, "sk_test_NEWS-rotated-secret", "key_rot_1");
    expect(next).toHaveLength(keys.length + 1);
    const successor = next[0];
    expect(ApiKeySchema.parse(successor)).toEqual(successor);
    expect(successor).toMatchObject({ id: "key_rot_1", kind: old.kind, scopes: old.scopes, expires_at: null, prefix: "sk_test_NEWS".slice(0, old.prefix.length) });
    const was = next.find((k) => k.id === old.id)!;
    expect(Date.parse(was.expires_at!) - Date.parse(DEMO_NOW)).toBe(24 * 60 * 60 * 1000);
    expect(was.revoked_at).toBeNull();
  });

  it("does nothing to a revoked or unknown key", () => {
    const revoked = { ...old, revoked_at: DEMO_NOW };
    expect(rotateKey([revoked], old.id, "sk_test_x", "k")).toEqual([revoked]);
    expect(rotateKey(keys, "missing", "sk_test_x", "k")).toEqual([...keys]);
  });

  it("flags keys unused for 30 days", () => {
    expect(isStale({ ...old, last_used_at: "2026-09-01T00:00:00.000Z" })).toBe(true);
    expect(isStale({ ...old, last_used_at: DEMO_NOW })).toBe(false);
  });
});

describe("simulator → events", () => {
  const at = DEMO_NOW;
  const base = createSimDevice({ kind: "glasses", name: "Lab G2", external_user_id: "usr_lab" }, 7);

  it("publishing a state change emits contract rows and the online/offline webhook", () => {
    const out = publishState({ ...base, state: { ...base.state, online: false, battery: 40 } }, 100, at);
    expect(out.device.published.online).toBe(false);
    expect(out.events.map((e) => e.capability)).toEqual(["presence.read", "telemetry.read"]);
    for (const e of out.events) expect(DeviceEventRowSchema.parse(e)).toEqual(e);
    expect(out.webhooks.map((w) => w.event_type)).toEqual(["device.offline"]);
    for (const w of out.webhooks) WebhookEventNameSchema.parse(w.event_type);
    expect(publishState(base, 1, at).events).toHaveLength(0);
  });

  it("an unticked scope denies with grant_missing; offline errors; otherwise delivered", () => {
    const ok = deliverTo(base, "present.notify", 1, at);
    DeliverRequestSchema.parse(ok.request);
    expect(ok.events[0]).toMatchObject({ outcome: "ok", error_code: null });
    expect(ok.webhooks[0].event_type).toBe("action.completed");

    const denied = deliverTo({ ...base, scopes: { ...base.scopes, present: false } }, "present.notify", 2, at);
    expect(denied.events[0]).toMatchObject({ outcome: "denied", error_code: "grant_missing" });
    expect(denied.webhooks[0].event_type).toBe("action.failed");

    const offline = deliverTo({ ...base, published: { ...base.published, online: false } }, "present.display", 3, at);
    expect(offline.events[0]).toMatchObject({ outcome: "error", error_code: "device_offline" });

    const magic = deliverTo({ ...base, external_user_id: "sim_confirm_denied" }, "ask.choice", 4, at);
    expect(magic.events[0].error_code).toBe("confirmation_denied");
  });

  it("simulated rows land in the unified log and are found by device id", () => {
    const out = deliverTo(base, "present.notify", 9, at);
    const log = buildLog({ events: [...out.events, ...DEMO_ACTIVITY.test.events], webhooks: out.webhooks, sessions: [], keys: DEMO_ENVS.test.keys });
    const hits = queryLog(log, { q: base.id });
    expect(hits.map((r) => r.type).sort()).toEqual(["delivery", "request", "webhook"]);
    expect(log[0].ids).toContain(base.id);
  });
});

describe("Connect customization scopes", () => {
  it("groups every scope under one tier and agrees with tierOfScope", () => {
    for (const { tier, scopes } of scopesByTier()) for (const s of scopes) expect(tierOfScope(s)).toBe(tier);
  });
});
