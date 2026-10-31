/**
 * A8 end to end, in memory: `/v1` delivery to an SDK-owned G2 → its own lens queue → the glasses
 * device routes (authenticated by the `device_credentials` token) → answers back into `dev_actions`.
 * Real pieces: the even_g2 adapter + dispatcher, the delivery services, `createDeviceHandlers`, the
 * inbox / answer code and the G2 compiler. Faked: the stores (`MemoryDeliveryStore`, the in-memory
 * `GlassesStore`) and the credential lookup.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("no database in this suite");
  },
}));

import { createDeviceHandlers } from "@/features/glasses/core/messages/device-handlers";
import { hashCredential, mintDeviceToken } from "@/features/glasses/core/devices/credentials";
import type { SdkGlassesDevice, SdkGlassesPort } from "@/features/glasses/core/devices/sdk-device";
import { createFakeDeviceStore, fakeLinker } from "@/features/glasses/core/testing/fake-device-store";
import { createFakeGlassesStore } from "@/features/glasses/core/testing/fake-store";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { createFakeChannel } from "@/features/glasses/core/testing/fake-channel";
import { createAdapterRegistry } from "../../adapters/registry";
import { createDesktopAdapter } from "../../adapters/desktop";
import { createEvenG2Adapter } from "../../adapters/even-g2";
import { createSimulatorAdapter } from "../../adapters/simulator";
import type { DeviceGrant } from "../../delivery/policy";
import { deviceAction, getAction } from "../action-service";
import type { DeliveryDeps } from "../delivery-common";
import { deliver } from "../delivery-service";
import { MemoryDeliveryStore, MemoryGrantStore } from "../delivery-store-memory";
import type { Scope } from "../delivery-store";
import { desktopUnavailable } from "../device-adapters";
import { createEvenG2Dispatcher } from "./even-g2-dispatch";
import { markDelivered, memoryLensActions, settle } from "./lens-actions";

const BASE = "http://127.0.0.1:3100";
const GRANT: DeviceGrant = {
  scopes: [
    { scope: "present.*", maxTier: "T4" },
    { scope: "ask.*", maxTier: "T4" },
    { scope: "presence.read", maxTier: "T4" },
  ],
  status: "active",
  expiresAt: null,
  revokedAt: null,
};

function world() {
  let NOW = Date.parse("2026-10-27T12:00:00Z");
  const now = () => NOW;
  const store = new MemoryDeliveryStore();
  store.now = now;
  const grants = new MemoryGrantStore();
  const lens = createFakeGlassesStore();
  const lensActions = memoryLensActions(store);
  const creds = new Map<string, SdkGlassesDevice>();
  const touched: string[] = [];

  const port: SdkGlassesPort = {
    store: lens.store,
    async deviceFromTokenHash(hash) {
      return creds.get(hash) ?? null;
    },
    async touch(deviceId, at) {
      touched.push(deviceId);
      const d = store.devices.find((x) => x.id === deviceId);
      if (d) d.last_seen = at;
    },
    async revokeToken(deviceId) {
      for (const [h, d] of creds) if (d.id === deviceId) creds.delete(h);
    },
    delivered: async (deviceId, ids) => void (await markDelivered(lensActions, deviceId, ids)),
    settled: (deviceId, row) => settle(lensActions, deviceId, row),
  };

  const prosumer = createFakeDeviceStore();
  const ch = createFakeChannel({ liveAgents: 1 });
  const handlers = createDeviceHandlers({
    store: createFakeGlassesStore().store,
    devices: prosumer.devices,
    gateway: ch.gateway,
    linker: fakeLinker({}),
    allowPairStart: async () => true,
    sdk: port,
    now,
    sleep: async (ms: number) => void (NOW += ms),
  });

  const adapters = createAdapterRegistry([
    createEvenG2Adapter({ now, dispatch: createEvenG2Dispatcher({ store: lens.store, now }) }),
    createDesktopAdapter({ now, dispatch: desktopUnavailable }),
    createSimulatorAdapter({ now }),
  ]);

  /** Adds an SDK G2 for `externalUserId` in `scope`, granted, with a live credential; returns its token. */
  function addG2(scope: Scope, externalUserId: string) {
    const endUserId = store.endUsers.find((u) => u.external_user_id === externalUserId && u.project_id === scope.projectId)?.id ?? store.addEndUser(scope, externalUserId);
    const row = store.addDevice(scope, { kind: "glasses", end_user_id: endUserId, adapter_id: "even_g2", vendor: "even_realities", model: "even_g2" });
    grants.set({ ...scope, endUserId, deviceId: row.id }, GRANT);
    const token = mintDeviceToken();
    creds.set(hashCredential(token), { id: row.id, projectId: scope.projectId, env: scope.env });
    return { id: row.id, token, endUserId };
  }

  let onSleep: (() => Promise<void>) | null = null;
  const deps: DeliveryDeps = {
    store,
    grants,
    adapters,
    now,
    sleep: async (ms) => {
      NOW += ms;
      const hook = onSleep;
      onSleep = null;
      if (hook) await hook();
    },
    askPollMs: 1000,
  };

  const get = (path: string, token: string) =>
    new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const post = (path: string, body: unknown, token: string) =>
    new Request(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const inbox = async (token: string) => handlers.inbox(get("/api/glasses/device/inbox?wait=0", token));

  return {
    store,
    grants,
    lens,
    deps,
    handlers,
    touched,
    addG2,
    inbox,
    post,
    advance: (ms: number) => void (NOW += ms),
    whileHeld: (fn: () => Promise<void>) => void (onSleep = fn),
  };
}

const A: Scope = { projectId: "proj-a", env: "live" };
const B: Scope = { projectId: "proj-b", env: "live" };

describe("SDK G2: deliver → its own lens queue", () => {
  it("present.notify via /deliver is queued for the SDK device, then the glasses' inbox delivers it", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    const res = await deliver(w.deps, A, "u1", { intent: "notify", content: { text: "Meeting moved to 3pm." }, urgency: "normal", idempotency_key: "k1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).toMatchObject({ routed_to: { device_id: g2.id, kind: "glasses" }, status: "queued" });
    const action = w.store.actions[0];
    expect(action.result).toMatchObject({ lens_message_id: expect.any(String) });

    const r = await w.inbox(g2.token);
    expect(r.status).toBe(200);
    const { messages } = (await r.json()) as { messages: GlassesMessage[] };
    expect(messages).toHaveLength(1);
    // D3: the words arrive exactly as delivered.
    expect(messages[0]).toMatchObject({ id: action.result!.lens_message_id, kind: "notify", payload: { title: "", body: "Meeting moved to 3pm." } });
    // Picked up is the end of a notice (ruled 2026-10-31).
    expect(w.store.actions[0].status).toBe("done");
    expect((await getAction(w.deps, A, action.id)).body).toMatchObject({ status: "done" });
  });

  it("present.display compiles through the G2 compiler into a screen row; content that does not fit is refused, never rewritten", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    const ok = await deviceAction(w.deps, A, g2.id, "present.display", {
      idempotency_key: "d1",
      args: { blocks: [{ id: "h", type: "heading", text: "Gate B12" }, { id: "t", type: "text", content: "Boarding 14:05" }] },
    });
    expect(ok).toMatchObject({ ok: true, status: 202 });
    const [row] = await w.lens.store.listInbox(g2.id, new Date(Date.parse("2026-10-27T12:00:00Z")).toISOString(), null);
    expect(row.kind).toBe("screen");
    expect(JSON.stringify(row.payload)).toContain("Boarding 14:05");

    const tooLong = await deviceAction(w.deps, A, g2.id, "present.display", {
      idempotency_key: "d2",
      args: { blocks: [{ id: "t", type: "text", content: "word ".repeat(150).trim() }] },
    });
    expect(tooLong).toMatchObject({ ok: false, code: "invalid_request" });
  });

  it("🔒 ask.choice: the wearer's answer resolves dev_actions, so the 200s hold and GET /v1/actions/{id} see it", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    w.whileHeld(async () => {
      const { messages } = (await (await w.inbox(g2.token)).json()) as { messages: GlassesMessage[] };
      const ask = messages.find((m) => m.kind === "ask")!;
      expect(ask.payload).toEqual({ question: "Join the call?", options: ["Yes", "Later"] });
      const ans = await w.handlers.answer(w.post("/api/glasses/device/answer", { id: ask.id, index: 1 }, g2.token));
      expect(ans.status).toBe(200);
    });
    const res = await deviceAction(w.deps, A, g2.id, "ask.choice", {
      idempotency_key: "a1",
      args: { question: "Join the call?", options: [{ label: "Yes" }, { label: "Later" }] },
    });
    expect(res).toMatchObject({ ok: true, body: { status: "done" } });
    const id = (res as unknown as { body: { action_id: string } }).body.action_id;
    const polled = await getAction(w.deps, A, id);
    expect(polled.body).toMatchObject({ status: "done", result: { index: 1, label: "Later", lens_message_id: expect.any(String) } });
  });

  it("a dismissed ask settles done with dismissed:true", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    w.whileHeld(async () => {
      const { messages } = (await (await w.inbox(g2.token)).json()) as { messages: GlassesMessage[] };
      await w.handlers.dismiss(w.post("/api/glasses/device/dismiss", { id: messages[0].id }, g2.token));
    });
    const res = await deviceAction(w.deps, A, g2.id, "ask.choice", { idempotency_key: "a2", args: { question: "Now?", options: ["Yes", "No"] } });
    expect(res).toMatchObject({ ok: true, body: { status: "done" } });
    expect(w.store.actions[0].result).toMatchObject({ dismissed: true, index: null });
  });
});

describe("SDK G2: presence", () => {
  it("the glasses' authenticated poll stamps devices.last_seen, which the router's presence filter reads", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    w.store.devices[0].last_seen = null;
    const offline = await deviceAction(w.deps, A, g2.id, "present.notify", { idempotency_key: "p1", args: { body: "hi" } });
    expect(offline).toMatchObject({ ok: false, code: "device_offline" });

    expect((await w.inbox(g2.token)).status).toBe(200);
    expect(w.touched).toEqual([g2.id]);
    expect(w.store.devices[0].last_seen).not.toBeNull();
    const online = await deviceAction(w.deps, A, g2.id, "present.notify", { idempotency_key: "p2", args: { body: "hi" } });
    expect(online).toMatchObject({ ok: true });
  });
});

describe("🔒 SDK G2: tenant isolation", () => {
  it("a device credential of project A never sees or answers project B's lens rows", async () => {
    const w = world();
    const a = w.addG2(A, "u1");
    const b = w.addG2(B, "u1");
    await deviceAction(w.deps, B, b.id, "present.notify", { idempotency_key: "b1", args: { body: "for B only" } });
    // B's device id addressed through A's project is not found.
    expect(await deviceAction(w.deps, A, b.id, "present.notify", { idempotency_key: "x", args: { body: "x" } })).toMatchObject({ ok: false, code: "not_found" });

    const fromA = (await (await w.inbox(a.token)).json()) as { messages: GlassesMessage[] };
    expect(fromA.messages).toEqual([]);
    const bRow = (await w.lens.store.listInbox(b.id, "2026-10-27T12:00:00.000Z", null))[0];
    const stolen = await w.handlers.answer(w.post("/api/glasses/device/answer", { id: bRow.id, index: 0 }, a.token));
    expect(stolen.status).toBe(404);
    const fromB = (await (await w.inbox(b.token)).json()) as { messages: GlassesMessage[] };
    expect(fromB.messages.map((m) => m.id)).toEqual([bRow.id]);
  });

  it("an unknown or revoked token is a 401 on every SDK-capable route", async () => {
    const w = world();
    const g2 = w.addG2(A, "u1");
    expect((await w.inbox("glsdt_nope")).status).toBe(401);
    expect((await w.handlers.unpair(w.post("/api/glasses/device/unpair", {}, g2.token))).status).toBe(200);
    expect((await w.inbox(g2.token)).status).toBe(401);
  });
});

describe("desktop", () => {
  it("an SDK-owned desktop gets a typed capability_unsupported, not a vendor_error", async () => {
    const w = world();
    const user = w.store.addEndUser(A, "u9");
    const mac = w.store.addDevice(A, { kind: "desktop", end_user_id: user, adapter_id: "desktop", vendor: "apple", model: "macos" });
    w.grants.set({ ...A, endUserId: user, deviceId: mac.id }, GRANT);
    const res = await deviceAction(w.deps, A, mac.id, "present.notify", { idempotency_key: "m1", args: { body: "hi" } });
    expect(res).toMatchObject({ ok: false, code: "capability_unsupported" });
    expect((res as { message: string }).message).toMatch(/Dopl account/);
  });
});
