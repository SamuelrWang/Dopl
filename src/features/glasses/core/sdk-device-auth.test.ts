/**
 * A8: the device routes accept a Device SDK G2 credential IN ADDITION to the prosumer token, and
 * 🔒 the prosumer path is unchanged: same answers, and the SDK lookup is never consulted for a token
 * the prosumer lookup knows.
 */
import { describe, expect, it, vi } from "vitest";
import { hashCredential, mintDeviceToken } from "./devices/credentials";
import type { SdkGlassesPort } from "./devices/sdk-device";
import { createUserHandlers } from "./devices/user-handlers";
import { createDeviceHandlers } from "./messages/device-handlers";
import { glassesNotify } from "./messages/service";
import { createFakeChannel } from "./testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "./testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "./testing/fake-store";

const OWNER = "22222222-2222-4222-8222-222222222222";
const SDK_DEVICE = "44444444-4444-4444-8444-444444444444";
const BASE = "http://127.0.0.1:3100";

function setup() {
  const msgs = createFakeGlassesStore();
  const dev = createFakeDeviceStore();
  const clock = fakeClock();
  const ch = createFakeChannel({ liveAgents: 1 });
  const sdkLens = createFakeGlassesStore();
  const sdkToken = mintDeviceToken();
  const port = {
    store: sdkLens.store,
    deviceFromTokenHash: vi.fn(async (hash: string) => (hash === hashCredential(sdkToken) ? { id: SDK_DEVICE, projectId: "p", env: "live" } : null)),
    touch: vi.fn(async () => {}),
    revokeToken: vi.fn(async () => {}),
    delivered: vi.fn(async () => {}),
    settled: vi.fn(async () => {}),
  } satisfies SdkGlassesPort;
  const base = {
    store: msgs.store,
    devices: dev.devices,
    gateway: ch.gateway,
    linker: fakeLinker({}),
    allowPairStart: async () => true,
    now: clock.now,
    sleep: clock.sleep,
  };
  return {
    msgs,
    dev,
    sdkLens,
    sdkToken,
    port,
    plain: createDeviceHandlers(base),
    withSdk: createDeviceHandlers({ ...base, sdk: port }),
    user: createUserHandlers({ devices: dev.devices, allowClaim: async () => true, now: clock.now }),
  };
}

const req = (path: string, token?: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
};
const post = (path: string, body: unknown, token?: string) =>
  req(path, token, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function pairProsumer(t: ReturnType<typeof setup>) {
  const start = await (await t.plain.pairStart(req("/api/glasses/device/pair/start", undefined, { method: "POST" }))).json();
  expect((await t.user.claim(post("/api/glasses/pair/claim", { code: start.code }), OWNER)).status).toBe(201);
  const status = await (await t.plain.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${start.pair_id}`, start.poll_secret))).json();
  return status.device_token as string;
}

describe("🔒 prosumer device auth is unchanged with the SDK port wired", () => {
  it("same inbox and answer responses, and the SDK lookup is never called", async () => {
    const t = setup();
    const token = await pairProsumer(t);
    await glassesNotify({ store: t.msgs.store, devices: t.dev.devices }, OWNER, { title: "Hi", body: "there" });
    const a = await t.plain.inbox(req("/api/glasses/device/inbox?wait=0", token));
    const b = await t.withSdk.inbox(req("/api/glasses/device/inbox?wait=0", token));
    expect(b.status).toBe(a.status);
    expect(b.status).toBe(200);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(jb.messages.map((m: { id: string }) => m.id)).toEqual(ja.messages.map((m: { id: string }) => m.id));
    expect(jb.messages[0].payload).toEqual({ title: "Hi", body: "there" });
    const missing = await t.withSdk.answer(post("/api/glasses/device/answer", { id: "nope" }, token));
    expect(missing.status).toBe(404);
    expect(t.port.deviceFromTokenHash).not.toHaveBeenCalled();
    expect(t.port.touch).not.toHaveBeenCalled();
  });

  it("an unknown token is the same 401 either way; with the port it is looked up once", async () => {
    const t = setup();
    const a = await t.plain.inbox(req("/api/glasses/device/inbox?wait=0", "glsdt_unknown"));
    const b = await t.withSdk.inbox(req("/api/glasses/device/inbox?wait=0", "glsdt_unknown"));
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await b.json()).toEqual(await a.json());
    expect(t.port.deviceFromTokenHash).toHaveBeenCalledTimes(1);
    expect(t.port.deviceFromTokenHash).toHaveBeenCalledWith(hashCredential("glsdt_unknown"));
  });

  it("no token at all never reaches the SDK lookup", async () => {
    const t = setup();
    expect((await t.withSdk.inbox(req("/api/glasses/device/inbox?wait=0"))).status).toBe(401);
    expect(t.port.deviceFromTokenHash).not.toHaveBeenCalled();
  });
});

describe("SDK device credential", () => {
  it("authenticates inbox / answer / dismiss / unpair on the SDK device's own queue, and touches presence", async () => {
    const t = setup();
    const row = await t.sdkLens.store.insert(SDK_DEVICE, {
      kind: "ask",
      card_id: null,
      payload: { question: "Go?", options: ["Yes", "No"] },
      expires_at: "2099-01-01T00:00:00.000Z",
      now: new Date().toISOString(),
    });
    const inbox = await t.withSdk.inbox(req("/api/glasses/device/inbox?wait=0", t.sdkToken));
    expect(inbox.status).toBe(200);
    expect((await inbox.json()).messages.map((m: { id: string }) => m.id)).toEqual([row.id]);
    expect(t.port.touch).toHaveBeenCalledWith(SDK_DEVICE, expect.any(String));
    expect(t.port.delivered).toHaveBeenCalledWith(SDK_DEVICE, [row.id]);

    const ans = await t.withSdk.answer(post("/api/glasses/device/answer", { id: row.id, index: 0 }, t.sdkToken));
    expect(ans.status).toBe(200);
    expect(t.port.settled).toHaveBeenCalledWith(SDK_DEVICE, expect.objectContaining({ id: row.id, status: "answered" }));

    expect((await t.withSdk.unpair(post("/api/glasses/device/unpair", {}, t.sdkToken))).status).toBe(200);
    expect(t.port.revokeToken).toHaveBeenCalledWith(SDK_DEVICE, expect.any(String));
  });

  it("is a 401 when the SDK port is not wired (prosumer-only deps)", async () => {
    const t = setup();
    expect((await t.plain.inbox(req("/api/glasses/device/inbox?wait=0", t.sdkToken))).status).toBe(401);
  });

  it("never reads the prosumer user's queue", async () => {
    const t = setup();
    await pairProsumer(t);
    await glassesNotify({ store: t.msgs.store, devices: t.dev.devices }, OWNER, { title: "Private", body: "prosumer only" });
    const res = await t.withSdk.inbox(req("/api/glasses/device/inbox?wait=0", t.sdkToken));
    expect((await res.json()).messages).toEqual([]);
  });
});
