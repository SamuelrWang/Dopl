/**
 * 🔒 W1.2 Gaps #1 NOTICE ROUND TRIP: `glasses_notify` and `glasses_get_answer` for a MIGRATED G2,
 * through the real `@dopl/sdk` client → the real `/api/v1` device-action / actions route handlers
 * (developer-key auth, grant + policy, the even_g2 adapter and its dispatcher) → the device's SDK lens
 * queue → the glasses' inbox, authenticated by the device's LEGACY prosumer token.
 *
 * Faked: the stores (memory), the developer-key table, the clock. Nothing else. World setup mirrors
 * `seam-round-trip.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/shared/supabase/admin", async () => {
  const m = await import("../fake-dev-db");
  return { supabaseAdmin: () => m.fakeDb };
});
vi.mock("@/features/device-sdk/server/sdk-delivery-flag", () => ({ sdkDeliveryFor: vi.fn() }));

import { Dopl } from "../../../../../packages/sdk/src/index";
import { GET as contextGET } from "@/app/api/v1/users/[external_user_id]/context/route";
import { POST as deliverPOST } from "@/app/api/v1/users/[external_user_id]/deliver/route";
import { POST as deviceActionPOST } from "@/app/api/v1/devices/[device_id]/actions/[capability]/route";
import { GET as actionGET } from "@/app/api/v1/actions/[id]/route";
import { SDK_LENS_HEADERS, sdkUserLens, sdkUserNotices } from "@/features/display/server/sdk-lens";
import { glassesGetAnswer, glassesNotify, SDK_NOTIFY_TTL_SEC, type GlassesSdkUser } from "@/features/glasses/core/messages/service";
import { hashCredential } from "@/features/glasses/core/devices/credentials";
import type { SdkGlassesPort } from "@/features/glasses/core/devices/sdk-device";
import { createDeviceHandlers } from "@/features/glasses/core/messages/device-handlers";
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import { createFakeChannel } from "@/features/glasses/core/testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "@/features/glasses/core/testing/fake-device-store";
import { createFakeGlassesStore } from "@/features/glasses/core/testing/fake-store";
import { createAdapterRegistry } from "../../adapters/registry";
import { createEvenG2Adapter } from "../../adapters/even-g2";
import type { DeviceGrant } from "../../delivery/policy";
import { setDeliveryDepsForTests } from "../delivery-routes";
import { MemoryDeliveryStore, MemoryGrantStore } from "../delivery-store-memory";
import { setDevEventSinkForTests } from "../events";
import { fakeStore, resetFakeStore } from "../fake-dev-db";
import { mintApiKey } from "../keys";
import { createEvenG2Dispatcher, SDK_NOTIFY_TTL_S } from "./even-g2-dispatch";
import { markDelivered, memoryLensActions, settle } from "./lens-actions";

const PROJECT = "proj-dopl-app";
const LIVE = { projectId: PROJECT, env: "live" as const };
/** The Dopl user id IS the `external_user_id` under the Dopl App project (Plan §8). */
const DOPL_USER = "22222222-2222-4222-8222-222222222222";
const LEGACY_TOKEN = "glsdt_legacy_token_kept_through_migration";
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

let NOW: number;
let key: string;
let onHold: (() => Promise<void>) | null;

async function inProcessFetch(input: string, init: RequestInit): Promise<Response> {
  const req = new NextRequest(input, init as ConstructorParameters<typeof NextRequest>[1]);
  const path = new URL(input).pathname.replace(/^\/api\/v1\//, "").split("/").map(decodeURIComponent);
  const p = (o: Record<string, string>) => ({ params: Promise.resolve(o) });
  if (path[0] === "users" && path[2] === "deliver") return deliverPOST(req, p({ external_user_id: path[1] }));
  if (path[0] === "users" && path[2] === "context") return contextGET(req, p({ external_user_id: path[1] }));
  if (path[0] === "actions") return actionGET(req, p({ id: path[1] }));
  if (path[0] === "devices" && path[2] === "actions") return deviceActionPOST(req, p({ device_id: path[1], capability: path[3] }));
  return new Response("no route", { status: 404 });
}

async function world() {
  const store = new MemoryDeliveryStore();
  store.now = () => NOW;
  const grants = new MemoryGrantStore();
  const sdkQueue = createFakeGlassesStore({ idBlock: "9000" });
  const prosumerQueue = createFakeGlassesStore();
  const lensActions = memoryLensActions(store);

  // The prosumer G2 as paired before W1.1: a legacy link with its token.
  const prosumer = createFakeDeviceStore();
  const link = await prosumer.devices.insertDevice({ userId: DOPL_USER, name: "Samuel's G2", platform: "even_g2", now: new Date(NOW).toISOString() });
  await prosumer.devices.setTokenHash(link.id, hashCredential(LEGACY_TOKEN));

  // W1.1's migration: an SDK row under the Dopl App project with THE SAME id, granted, flag on.
  const endUser = store.addEndUser(LIVE, DOPL_USER);
  const device = store.addDevice(LIVE, { id: link.id, kind: "glasses", end_user_id: endUser, adapter_id: "even_g2", vendor: "even_realities", model: "even_g2" });
  grants.set({ ...LIVE, endUserId: endUser, deviceId: device.id }, GRANT);

  setDeliveryDepsForTests({
    store,
    grants,
    adapters: createAdapterRegistry([createEvenG2Adapter({ now: () => NOW, dispatch: createEvenG2Dispatcher({ store: sdkQueue.store, now: () => NOW }) })]),
    now: () => NOW,
    sleep: async (ms) => {
      NOW += ms;
      const hook = onHold;
      onHold = null;
      if (hook) await hook();
    },
    askPollMs: 1000,
  });

  const port: SdkGlassesPort = {
    store: sdkQueue.store,
    deviceFromTokenHash: async () => null,
    touch: async () => {},
    revokeToken: async () => {},
    delivered: (id, ids) => markDelivered(lensActions, id, ids),
    settled: (id, row) => settle(lensActions, id, row),
    migratedDeviceIds: async (userId) => (userId === DOPL_USER ? [link.id] : []),
  };
  const handlers = createDeviceHandlers({
    store: prosumerQueue.store,
    devices: prosumer.devices,
    gateway: createFakeChannel({ liveAgents: 1 }).gateway,
    linker: fakeLinker({}),
    allowPairStart: async () => true,
    sdk: port,
    now: () => NOW,
    sleep: async (ms) => void (NOW += ms),
  });
  const glasses = (path: string, body?: unknown) =>
    new Request(`https://app.example${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  // As production builds it (`sdk-lens.ts › createDoplApp`): asks do not hold.
  const dopl = new Dopl({ apiKey: key, baseUrl: "https://app.example/api/v1", fetch: inProcessFetch, headers: { ...SDK_LENS_HEADERS } });
  const lens = sdkUserLens(dopl, DOPL_USER);
  const notices: GlassesSdkUser = sdkUserNotices(dopl, DOPL_USER, [link.id]);
  // The glasses tools' deps as `glasses/core/mcp/exposure.ts` builds them, the port over the real client.
  const tools = { store: prosumerQueue.store, devices: prosumer.devices, now: () => NOW, sdkNotices: { forUser: async () => notices } };
  return { store, sdkQueue, prosumerQueue, handlers, glasses, lens, link, notices, tools, endUser };
}

let logs: Array<Record<string, unknown>>;
beforeEach(async () => {
  NOW = Date.parse("2026-10-28T12:00:00Z");
  onHold = null;
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: unknown) => {
    if (typeof m === "string" && m.startsWith("[display] ")) logs.push(JSON.parse(m.slice("[display] ".length)));
  });
  setDevEventSinkForTests({ write: async () => undefined });
  resetFakeStore();
  fakeStore.projects.set(PROJECT, { id: PROJECT, org_id: "org-dopl-app", api_version: "2026-10-27" });
  key = (await mintApiKey({ projectId: PROJECT, env: "live", kind: "secret" })).secret;
});

describe("W1.2 Gaps #1 notices over @dopl/sdk", () => {
  it("🔒 glasses_notify lands as ONE notify (title + body) on the legacy-token inbox; no prosumer row", async () => {
    const w = await world();
    const r = await glassesNotify(w.tools, DOPL_USER, { title: "Build", body: "Green on main" });
    expect(r).toMatchObject({ id: expect.any(String), status: "pending" });
    expect(w.store.actions).toEqual([expect.objectContaining({ device_id: w.link.id, capability: "present.notify" })]);
    const { messages } = (await (await w.handlers.inbox(w.glasses("/api/glasses/device/inbox?wait=0"))).json()) as { messages: GlassesMessage[] };
    expect(messages).toEqual([expect.objectContaining({ kind: "notify", payload: { title: "Build", body: "Green on main" } })]);
    expect(Date.parse(messages[0].expires_at) - NOW).toBe(SDK_NOTIFY_TTL_SEC * 1000);
    expect(w.prosumerQueue.rows).toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({ evt: "sdk_lens", op: "notify", outcome: "ok", ms: expect.any(Number) }));
  });

  it("the notice lifetime the glasses tools assume is the adapter's", () => {
    expect(SDK_NOTIFY_TTL_SEC).toBe(SDK_NOTIFY_TTL_S);
  });

  it("🔒 glasses_get_answer reads an SDK ask's answer by its delivery id", async () => {
    const w = await world();
    const { deliveryId } = await w.lens.startAsk({ question: "Ship?", options: ["Ship", "Wait"], idempotencyKey: "nrt-1" });
    const { messages } = (await (await w.handlers.inbox(w.glasses("/api/glasses/device/inbox?wait=0"))).json()) as { messages: GlassesMessage[] };
    expect((await w.handlers.answer(w.glasses("/api/glasses/device/answer", { id: messages[0].id, index: 0 }))).status).toBe(200);
    expect(deliveryId).toBe(w.store.actions[0].id);
    expect(await glassesGetAnswer(w.tools, DOPL_USER, { id: deliveryId })).toEqual({
      id: deliveryId,
      status: "answered",
      answer: { choice: "Ship", index: 0, at: expect.any(String) },
    });
  });

  it("🔒 an action on ANOTHER user's device (same Dopl App project) is not found", async () => {
    const w = await world();
    const other = w.store.addEndUser(LIVE, "33333333-3333-4333-8333-333333333333");
    const theirs = w.store.addDevice(LIVE, { id: "44444444-4444-4444-8444-444444444444", kind: "glasses", end_user_id: other, adapter_id: "even_g2", vendor: "even_realities", model: "even_g2" });
    expect(theirs.id).not.toBe(w.link.id);
    await w.lens.screen({ blocks: [{ id: "h", type: "heading", text: "mine" }], idempotencyKey: "nrt-2" });
    const mine = w.store.actions[0];
    // Same id read through a port scoped to someone else's devices: refused before any field leaks.
    const stranger = sdkUserNotices(new Dopl({ apiKey: key, baseUrl: "https://app.example/api/v1", fetch: inProcessFetch }), "33333333-3333-4333-8333-333333333333", [theirs.id]);
    expect(await stranger.action(mine.id)).toEqual({ ok: false, code: "not_found", fallback: false });
    expect(await w.notices.action(mine.id)).toMatchObject({ ok: true, value: { device_id: w.link.id, capability: "present.display" } });
  });
});
