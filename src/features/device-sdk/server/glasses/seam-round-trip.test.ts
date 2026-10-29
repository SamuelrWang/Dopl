/**
 * 🔒 W1.2 ASK ROUND TRIP (Plan §7.1, §10 "Ask round trip"): the display seam's SDK lens asks a
 * MIGRATED G2 through the real `@dopl/sdk` client → the real `/api/v1` deliver / actions route handlers
 * (developer-key auth, routing, policy, the even_g2 adapter and its dispatcher) → the device's SDK lens
 * queue → the glasses' inbox and answer routes, authenticated by the device's LEGACY prosumer token
 * (the migrated device keeps it) → `dev_actions` settles → the answer route hands the settled action,
 * with the ask's channel-link key, to the app bridge → the ask's action reads answered.
 * 🔒 Gap #3: `Prefer: respond-async` — the deliver returns BEFORE the wearer answers; nothing is held.
 *
 * Faked: the stores (memory), the developer-key table, the clock. Nothing else.
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
import { GET as actionGET } from "@/app/api/v1/actions/[id]/route";
import { parseSdkAskKey, sdkAskKey } from "@/features/display/server/sdk-ask-key";
import { SDK_LENS_HEADERS, sdkUserLens } from "@/features/display/server/sdk-lens";
import { hashCredential } from "@/features/glasses/core/devices/credentials";
import type { SdkGlassesPort, SdkSettledAction } from "@/features/glasses/core/devices/sdk-device";
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
import { createEvenG2Dispatcher } from "./even-g2-dispatch";
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
  const bridged: Array<{ owner: string; settled: SdkSettledAction[] }> = [];
  const handlers = createDeviceHandlers({
    store: prosumerQueue.store,
    devices: prosumer.devices,
    gateway: createFakeChannel({ liveAgents: 1 }).gateway,
    linker: fakeLinker({}),
    allowPairStart: async () => true,
    sdk: port,
    sdkAnswerLinked: async (owner, settled) => {
      bridged.push({ owner: owner.user_id, settled });
      return "ok";
    },
    now: () => NOW,
    sleep: async (ms) => void (NOW += ms),
  });
  const glasses = (path: string, body?: unknown) =>
    new Request(`https://app.example${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${LEGACY_TOKEN}`, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const lens = sdkUserLens(new Dopl({ apiKey: key, baseUrl: "https://app.example/api/v1", fetch: inProcessFetch, headers: { ...SDK_LENS_HEADERS } }), DOPL_USER);
  return { store, sdkQueue, prosumerQueue, handlers, glasses, lens, link, bridged };
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

describe("W1.2 ask round trip over @dopl/sdk", () => {
  it("🔒 the ask returns at once (no hold); the wearer's tap settles it and reaches the app bridge with the channel link", async () => {
    const w = await world();
    const CHAN = "55555555-5555-4555-8555-555555555555";
    const key = sdkAskKey({ channelId: CHAN, displayId: "ship-1", nonce: "d-0000aaaa" });
    let held = false;
    onHold = async () => void (held = true);
    const started = NOW;

    const ticket = await w.lens.startAsk({ question: "Ship the build?", options: ["Ship", "Wait"], idempotencyKey: key });

    // Delivered and back with no server hold: no sleep ran, the clock did not move, the wearer has not answered.
    expect(held).toBe(false);
    expect(NOW).toBe(started);
    expect(ticket).toEqual({ deliveryId: w.store.actions[0].id, deviceId: w.link.id });
    expect(w.store.actions[0].status).toBe("queued");
    expect(await w.lens.askOutcome(ticket.deliveryId)).toBeNull();

    const { messages } = (await (await w.handlers.inbox(w.glasses("/api/glasses/device/inbox?wait=0"))).json()) as { messages: GlassesMessage[] };
    expect(messages).toEqual([expect.objectContaining({ kind: "ask", payload: { question: "Ship the build?", options: ["Ship", "Wait"] }, status: "delivered" })]);
    expect((await w.handlers.answer(w.glasses("/api/glasses/device/answer", { id: messages[0].id, index: 1 }))).status).toBe(200);

    // The answer route handed the settled action to the bridge: the key names the decision's channel.
    expect(w.bridged).toHaveLength(1);
    expect(w.bridged[0].owner).toBe(DOPL_USER);
    expect(w.bridged[0].settled).toEqual([expect.objectContaining({ id: ticket.deliveryId, idempotency_key: key, status: "done", result: expect.objectContaining({ index: 1, label: "Wait" }) })]);
    expect(parseSdkAskKey(w.bridged[0].settled[0].idempotency_key)).toEqual({ channelId: CHAN, displayId: "ship-1" });

    expect(await w.lens.askOutcome(ticket.deliveryId)).toEqual({ status: "answered", index: 1, label: "Wait", deviceId: w.link.id });
    // The prosumer queue was never written: the lens copy went over the SDK only.
    expect(w.prosumerQueue.rows).toEqual([]);
    expect(logs).toContainEqual(expect.objectContaining({ evt: "sdk_lens", op: "ask", outcome: "ok", delivery_id: ticket.deliveryId }));
  });

  it("🔒 one copy: replaying the ask with the same key returns the first delivery, no second lens row", async () => {
    const w = await world();
    const a = await w.lens.startAsk({ question: "Join?", options: ["Yes", "No"], idempotencyKey: "rt-dup" });
    const b = await w.lens.startAsk({ question: "Join?", options: ["Yes", "No"], idempotencyKey: "rt-dup" });
    expect(b.deliveryId).toBe(a.deliveryId);
    expect(w.store.actions).toHaveLength(1);
    expect(w.sdkQueue.rows).toHaveLength(1);
  });

  it("a dismiss on the lens reads back as dismissed", async () => {
    const w = await world();
    const ticket = await w.lens.startAsk({ question: "Join?", options: ["Yes", "No"], idempotencyKey: "rt-2" });
    const { messages } = (await (await w.handlers.inbox(w.glasses("/api/glasses/device/inbox?wait=0"))).json()) as { messages: GlassesMessage[] };
    expect((await w.handlers.dismiss(w.glasses("/api/glasses/device/dismiss", { id: messages[0].id }))).status).toBe(200);
    expect(await w.lens.askOutcome(ticket.deliveryId)).toEqual({ status: "dismissed", deviceId: w.link.id });
    expect(w.bridged).toEqual([]);
  });

  it("presence and a status screen over the same path; the screen lands on the legacy-token inbox", async () => {
    const w = await world();
    expect(await w.lens.state()).toEqual({ paired: true, online: true });
    const d = await w.lens.screen({ blocks: [{ id: "h", type: "heading", text: "Deploy done" }], idempotencyKey: "rt-3" });
    expect(d).toMatchObject({ routed_to: { device_id: w.link.id, kind: "glasses" }, status: "queued" });
    const { messages } = (await (await w.handlers.inbox(w.glasses("/api/glasses/device/inbox?wait=0"))).json()) as { messages: GlassesMessage[] };
    expect(messages.map((m) => m.kind)).toEqual(["screen"]);
    expect(JSON.stringify(messages[0].payload)).toContain("Deploy done");
    expect(w.store.actions[0].status).toBe("delivered");
    expect(logs.map((l) => [l.op, l.outcome])).toEqual([["context", "ok"], ["show", "ok"]]);
  });

  it("offline glasses: the SDK refuses (device_offline), a refusal the seam reports instead of a second copy", async () => {
    const w = await world();
    w.store.devices[0].last_seen = null;
    // (Paired-but-offline reads `connections.list`, a Connect-store route: unit-tested in `sdk-lens.test.ts`.)
    await expect(w.lens.screen({ blocks: [{ id: "h", type: "heading", text: "x" }], idempotencyKey: "rt-4" })).rejects.toMatchObject({ code: "device_offline", fallback: false });
  });
});
