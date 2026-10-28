/**
 * A5 routes end to end over HTTP handlers, the SIMULATOR adapter and the in-memory ports:
 * context, deliver (route + D3 enforcement + idempotency + rate limit), device actions (T4 deny,
 * needs_confirmation, ask hold), the action poll — and 🔒 every call writes exactly ONE `dev_events`
 * row carrying a `route_decision`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("./fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});

import { fakeStore, resetFakeStore } from "./fake-dev-db";
import { flushDevEvents, setDevEventSinkForTests } from "./events";
import { mintApiKey } from "./keys";
import { setDeliveryDepsForTests } from "./delivery-routes";
import { MemoryDeliveryStore, MemoryGrantStore } from "./delivery-store-memory";
import { createAdapterRegistry } from "../adapters/registry";
import { createSimulatorAdapter } from "../adapters/simulator";
import { GLASSES_REPLY_GUIDANCE } from "../delivery/glasses-guidance";
import {
  ActionSchema,
  DeliverResponseSchema,
  DeviceActionResponseSchema,
  DeviceContextSchema,
  ErrorResponseSchema,
} from "@dopl/device-contracts";
import type { ActionResult, CapabilityId, ContextProfile, Device, DeviceEventRow } from "../types";
import { GET as contextGET } from "@/app/api/v1/users/[external_user_id]/context/route";
import { POST as deliverPOST } from "@/app/api/v1/users/[external_user_id]/deliver/route";
import { POST as actionPOST } from "@/app/api/v1/devices/[device_id]/actions/[capability]/route";
import { GET as actionGET } from "@/app/api/v1/actions/[id]/route";

const PROJECT = "proj-1";
const scope = { projectId: PROJECT, env: "test" as const };
let NOW = Date.parse("2026-10-27T12:00:00Z");
let events: DeviceEventRow[] = [];
let store: MemoryDeliveryStore;
let grants: MemoryGrantStore;
let calls: Array<{ device: string; capability: CapabilityId; args: Record<string, unknown> }>;
let askStatus: ActionResult["status"];
let key: string;
let ids: { glasses: string; phone: string; home: string };

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });
const req = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const logged = async () => {
  await flushDevEvents();
  return events;
};
const deliver = (body: Record<string, unknown>, headers?: Record<string, string>) =>
  deliverPOST(req("users/u1/deliver", { urgency: "normal", ...body }, headers), params({ external_user_id: "u1" }));
const act = (deviceId: string, capability: string, body: Record<string, unknown>) =>
  actionPOST(req(`devices/${deviceId}/actions/${capability}`, body), params({ device_id: deviceId, capability }));

beforeEach(async () => {
  NOW = Date.parse("2026-10-27T12:00:00Z");
  events = [];
  calls = [];
  askStatus = "done";
  setDevEventSinkForTests({ write: async (rows) => void events.push(...rows) });
  resetFakeStore();
  fakeStore.projects.set(PROJECT, { id: PROJECT, org_id: "org-1", api_version: "2026-10-27" });
  key = (await mintApiKey({ projectId: PROJECT, env: "test", kind: "secret" })).secret;

  store = new MemoryDeliveryStore();
  store.now = () => NOW;
  grants = new MemoryGrantStore();
  const sim = createSimulatorAdapter({ now: () => NOW });
  const recording = {
    ...sim,
    async execute(device: Device, capability: CapabilityId, args: Record<string, unknown>): Promise<ActionResult> {
      calls.push({ device: device.id, capability, args });
      const res = await sim.execute(device, capability, args);
      return capability.startsWith("ask.") && res.status === "done" ? { ...res, status: askStatus, result: askStatus === "done" ? res.result : null } : res;
    },
  };
  const user = store.addEndUser(scope, "u1");
  ids = {
    glasses: store.addDevice(scope, { kind: "glasses", end_user_id: user }).id,
    phone: store.addDevice(scope, { kind: "phone", end_user_id: user, last_seen: new Date(NOW - 60_000).toISOString() }).id,
    home: store.addDevice(scope, { kind: "home_device", end_user_id: user, last_seen: new Date(NOW - 90_000).toISOString() }).id,
  };
  setDeliveryDepsForTests({
    store,
    grants,
    adapters: createAdapterRegistry([recording]),
    now: () => NOW,
    sleep: async (ms) => void (NOW += ms),
  });
});

async function oneEvent() {
  const rows = await logged();
  expect(rows).toHaveLength(1);
  expect(rows[0].route_decision).not.toBeNull();
  return rows[0];
}

describe("GET /v1/users/{id}/context", () => {
  it("active device, posture, available devices and the glasses profile (GLASSES_REPLY_GUIDANCE)", async () => {
    const res = await contextGET(req("users/u1/context"), params({ external_user_id: "u1" }));
    expect(res.status).toBe(200);
    const ctx = DeviceContextSchema.parse(await res.json());
    expect(ctx.active_device).toMatchObject({ id: ids.glasses, kind: "glasses" });
    expect(ctx.posture).toBe("glanceable");
    expect(ctx.available.map((d) => d.kind).sort()).toEqual(["glasses", "home_device", "phone"]);
    expect(ctx.profile?.prompt_append).toBe(GLASSES_REPLY_GUIDANCE);
    expect((await oneEvent()).external_user_id).toBe("u1");
  });

  it("404 for an unknown end user, still one event row with a decision", async () => {
    const res = await contextGET(req("users/zz/context"), params({ external_user_id: "zz" }));
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("not_found");
    await oneEvent();
  });
});

describe("POST /v1/users/{id}/deliver", () => {
  it("routes a short message to the active glasses and logs the decision", async () => {
    const res = await deliver({ intent: "message", content: { text: "Meeting moved to 3pm." }, idempotency_key: "k1" });
    expect(res.status).toBe(202);
    const body = DeliverResponseSchema.parse(await res.json());
    expect(body.routed_to).toMatchObject({ device_id: ids.glasses, kind: "glasses" });
    expect(body.status).toBe("done");
    const ev = await oneEvent();
    expect(ev).toMatchObject({ intent: "message", device_id: ids.glasses, capability: "present.display", profile_id: "glasses-default", outcome: "ok" });
    expect(ev.route_decision?.candidates).toHaveLength(3);
  });

  it("delivery_id is fetchable at GET /v1/actions/{id}; every response carries Request-Id = the event_id", async () => {
    const res = await deliver({ intent: "ask", content: { text: "Lunch?", options: [{ label: "Yes" }, { label: "No" }] }, idempotency_key: "poll" });
    const { delivery_id } = DeliverResponseSchema.parse(await res.json());
    const poll = await actionGET(req(`actions/${delivery_id}`), params({ id: delivery_id }));
    expect(ActionSchema.parse(await poll.json())).toMatchObject({ action_id: delivery_id, capability: "ask.choice", status: "done" });
    const rows = await logged();
    expect(res.headers.get("request-id")).toBe(rows[0].event_id);
    expect(poll.headers.get("request-id")).toBe(rows[1].event_id);
    const bad = await deliverPOST(new NextRequest("http://localhost/api/v1/users/u1/deliver", { method: "POST" }), params({ external_user_id: "u1" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("overflow send_to: a long reply goes to the phone UNCHANGED (D3)", async () => {
    const text = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n");
    const body = DeliverResponseSchema.parse(await (await deliver({ intent: "message", content: { text }, idempotency_key: "k2" })).json());
    expect(body.routed_to).toMatchObject({ device_id: ids.phone, kind: "phone" });
    expect(body.routed_to.reason).toMatch(/send_to phone/);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ blocks: [{ id: "text", type: "text", content: text }] });
  });

  it("overflow truncate: an exact prefix, never a rewrite", async () => {
    store.profiles.push({ scope, active: true, profile: { ...glassesOverride(), overflow: "truncate" } });
    const text = "one\ntwo\nthree";
    await deliver({ intent: "message", content: { text }, idempotency_key: "k3" });
    expect(calls[0].args).toEqual({ blocks: [{ id: "text", type: "text", content: "one" }] });
  });

  it("overflow callback: nothing delivered, the limits handed back", async () => {
    store.profiles.push({ scope, active: true, profile: { ...glassesOverride(), overflow: "callback" } });
    const res = await deliver({ intent: "message", content: { text: "a\nb" }, idempotency_key: "k4" });
    const body = await res.json();
    expect(DeliverResponseSchema.parse(body).status).toBe("failed");
    expect(body.overflow_callback).toMatchObject({ profile_id: "ar-glasses", limits: { max_lines: 1 } });
    expect(calls).toHaveLength(0);
  });

  it("idempotency: same key + same body replays the same delivery; a different body conflicts", async () => {
    const payload = { intent: "notify", content: { text: "hi" }, idempotency_key: "same" };
    const a = await (await deliver(payload, { "idempotency-key": "same" })).json();
    const b = await (await deliver(payload)).json();
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    const c = await deliver({ ...payload, content: { text: "different" } });
    expect(c.status).toBe(409);
    expect(ErrorResponseSchema.parse(await c.json()).error.code).toBe("idempotency_conflict");
    expect((await logged()).every((e) => e.route_decision !== null)).toBe(true);
    expect(await logged()).toHaveLength(3);
  });

  it("header and body idempotency keys must match", async () => {
    const res = await deliver({ intent: "notify", content: { text: "hi" }, idempotency_key: "a" }, { "idempotency-key": "b" });
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("invalid_request");
    await oneEvent();
  });

  it("rate limit per project → 429", async () => {
    setDeliveryDepsForTests({ store, grants, adapters: createAdapterRegistry([createSimulatorAdapter({ now: () => NOW })]), now: () => NOW, rateLimit: { max: 2, windowMs: 60_000 } });
    for (const k of ["r1", "r2"]) expect((await deliver({ intent: "notify", content: { text: "x" }, idempotency_key: k })).status).toBe(202);
    const res = await deliver({ intent: "notify", content: { text: "x" }, idempotency_key: "r3" });
    expect(res.status).toBe(429);
  });

  it("env isolation: a live key never sees test-env users or devices", async () => {
    const live = await mintApiKey({ projectId: PROJECT, env: "live", kind: "secret" });
    key = live.secret;
    const res = await deliver({ intent: "notify", content: { text: "x" }, idempotency_key: "l1" });
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("not_found");
  });
});

describe("POST /v1/devices/{id}/actions/{capability} + GET /v1/actions/{id}", () => {
  it("runs a capability on the simulator, then the poll returns the stored action", async () => {
    const res = await act(ids.glasses, "present.notify", { args: { body: "hi" }, idempotency_key: "a1" });
    expect(res.status).toBe(202);
    const { action_id, status } = DeviceActionResponseSchema.parse(await res.json());
    expect(status).toBe("done");
    const poll = await actionGET(req(`actions/${action_id}`), params({ id: action_id }));
    expect(ActionSchema.parse(await poll.json())).toMatchObject({ action_id, device_id: ids.glasses, capability: "present.notify", status: "done" });
    const rows = await logged();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.route_decision !== null)).toBe(true);
  });

  it("🔒 T4 is denied by default even with a T4 grant", async () => {
    grants.set({ ...scope, endUserId: store.endUsers[0].id, deviceId: ids.home }, {
      scopes: [{ scope: "act.*", maxTier: "T4" }],
      status: "active",
      expiresAt: null,
      revokedAt: null,
    });
    const res = await act(ids.home, "act.lock", { args: {}, idempotency_key: "t4" });
    expect(res.status).toBe(403);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("confirmation_denied");
    expect(calls).toHaveLength(0);
    expect((await oneEvent()).outcome).toBe("denied");
  });

  it("T4 with a confirmation profile → needs_confirmation, never executed", async () => {
    grants.set({ ...scope, endUserId: store.endUsers[0].id, deviceId: ids.home }, { scopes: [{ scope: "act.*", maxTier: "T4" }], status: "active", expiresAt: null, revokedAt: null });
    store.profiles.push({
      scope,
      active: true,
      profile: { id: "locks", match: { kind: "home_device" }, prompt_append: "", output: {}, allowed_capabilities: ["act.*"], confirmation: { T4: "trusted_surface" }, overflow: "truncate" },
    });
    const body = DeviceActionResponseSchema.parse(await (await act(ids.home, "act.lock", { args: {}, idempotency_key: "t4c" })).json());
    expect(body.status).toBe("needs_confirmation");
    expect(calls).toHaveLength(0);
  });

  it("ask.* holds until the answer lands (up to 200s), then returns it", async () => {
    askStatus = "delivered";
    setDeliveryDepsForTests({
      store,
      grants,
      adapters: createAdapterRegistry([{ ...createSimulatorAdapter({ now: () => NOW }), execute: async () => ({ status: "delivered", result: null, error: null }) }]),
      now: () => NOW,
      sleep: async (ms) => {
        NOW += ms;
        if (NOW > Date.parse("2026-10-27T12:00:05Z")) {
          const a = store.actions[0];
          if (a.status === "delivered") Object.assign(a, { status: "done", result: { index: 1, label: "No" } });
        }
      },
    });
    const res = await act(ids.glasses, "ask.choice", { args: { options: [{ label: "Yes" }, { label: "No" }] }, idempotency_key: "q1" });
    expect(DeviceActionResponseSchema.parse(await res.json()).status).toBe("done");
    expect(store.actions[0].result).toEqual({ index: 1, label: "No" });
  });

  it("an unanswered ask returns `delivered` after the 200s hold; the caller polls", async () => {
    setDeliveryDepsForTests({
      store,
      grants,
      adapters: createAdapterRegistry([{ ...createSimulatorAdapter({ now: () => NOW }), execute: async () => ({ status: "delivered", result: null, error: null }) }]),
      now: () => NOW,
      sleep: async (ms) => void (NOW += ms),
    });
    const start = NOW;
    const res = await act(ids.glasses, "ask.choice", { args: { options: [{ label: "Yes" }, { label: "No" }] }, idempotency_key: "q2" });
    expect(DeviceActionResponseSchema.parse(await res.json()).status).toBe("delivered");
    expect(NOW - start).toBeGreaterThanOrEqual(200_000);
    expect(NOW - start).toBeLessThan(202_000);
  });

  it("unknown device → 404; capability the device lacks → 422; magic offline id → 409", async () => {
    expect((await act("nope", "present.notify", { args: {}, idempotency_key: "x1" })).status).toBe(404);
    expect((await act(ids.home, "present.display", { args: {}, idempotency_key: "x2" })).status).toBe(422);
    const off = store.addDevice(scope, { kind: "phone", end_user_id: store.endUsers[0].id, id: "sim_device_offline_1" });
    expect((await act(off.id, "present.notify", { args: { body: "x" }, idempotency_key: "x3" })).status).toBe(409);
    expect(await logged()).toHaveLength(3);
  });

  it("idempotent replay of a device action does not execute twice", async () => {
    const body = { args: { body: "hi" }, idempotency_key: "dup" };
    const a = await (await act(ids.glasses, "present.notify", body)).json();
    const b = await (await act(ids.glasses, "present.notify", body)).json();
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
  });
});

function glassesOverride(): ContextProfile {
  return {
    id: "ar-glasses",
    version: 3,
    match: { kind: "glasses" },
    prompt_append: "User is on AR glasses. One line only.",
    output: { max_lines: 1 },
    allowed_capabilities: ["present.*", "ask.*"],
    overflow: "truncate",
  };
}
