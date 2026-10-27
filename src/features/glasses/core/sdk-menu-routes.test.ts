/**
 * A8b: the G2 plugin calls the menu routes and `/voice` too, and drops its pairing on a 401 from ANY of
 * them (glasses-mcp `plugin/src/core/app/session.ts`). So a Device SDK G2 token gets a fixed, data-free
 * answer there instead of a 401; an unknown token is still 401; and 🔒 a prosumer token's answers are
 * byte-identical with the SDK port wired, which is never consulted for it.
 */
import { describe, expect, it, vi } from "vitest";
import { hashCredential, mintDeviceToken } from "./devices/credentials";
import type { SdkGlassesPort } from "./devices/sdk-device";
import { SDK_MENU, createMenuHandlers } from "./menu/handlers";
import type { MenuChannelHandle, MenuGateway } from "./menu/types";
import { createFakeChannel } from "./testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "./testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "./testing/fake-store";
import { SDK_VOICE_REFUSAL, createVoiceHandlers } from "./voice/handlers";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";
const SDK_DEVICE = "44444444-4444-4444-8444-444444444444";
const MSG = "55555555-5555-4555-8555-555555555555";
const PROSUMER_TOKEN = "glsdt_prosumer";
const BASE = "http://127.0.0.1:3100/api/glasses/device";

function spyGateway() {
  const handle: MenuChannelHandle = {
    readMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
    awaitMessages: vi.fn(async () => []),
    createLaunch: vi.fn(async () => ({ directiveId: MSG, status: "launching" as const, agentId: null, agentName: "x", refusalReason: null })),
    getLaunch: vi.fn(async () => null),
    answerDisplay: vi.fn(async () => ({ answer: { block_id: "b", choice: "x", index: 0, at: "t", via: "glasses" } })),
  } as unknown as MenuChannelHandle;
  const gw: MenuGateway = {
    listChannels: vi.fn(async () => [{ id: OPS, name: "Ops", containerId: "c1", containerName: "Acme", lastActivity: "2026-09-27T01:00Z", unread: true }]),
    listSessions: vi.fn(async () => []),
    persistedAgentNames: vi.fn(async () => new Map()),
    runtimesFor: vi.fn(async () => new Map()),
    recentLaunchNames: vi.fn(async () => []),
    launchHistory: vi.fn(async () => [{ runtime: "codex", model: "gpt-6" }]),
    modelCatalogs: vi.fn(async () => []),
    openChannel: vi.fn(async () => handle),
  };
  const spies = [...Object.values(gw), ...Object.values(handle)] as ReturnType<typeof vi.fn>[];
  return { gw, spies };
}

function setup() {
  const dev = createFakeDeviceStore();
  const clock = fakeClock();
  const sdkToken = mintDeviceToken();
  const port = {
    store: createFakeGlassesStore().store,
    deviceFromTokenHash: vi.fn(async (hash: string) => (hash === hashCredential(sdkToken) ? { id: SDK_DEVICE, projectId: "p", env: "live" } : null)),
    touch: vi.fn(async () => {}),
    revokeToken: vi.fn(async () => {}),
    delivered: vi.fn(async () => {}),
    settled: vi.fn(async () => {}),
  } satisfies SdkGlassesPort;
  const { gw, spies } = spyGateway();
  const linker = fakeLinker({ [OPS]: { name: "Ops", members: [OWNER] } });
  const linkerSpies = [vi.spyOn(linker, "mostRecent"), vi.spyOn(linker, "linkable")];
  const base = {
    store: createFakeGlassesStore().store,
    devices: dev.devices,
    gateway: createFakeChannel().gateway,
    linker,
    allowPairStart: async () => true,
    now: clock.now,
    sleep: clock.sleep,
  };
  const allowRead = vi.fn(async () => true);
  const menuDeps = { ...base, menu: gw, allowRead, allowLaunch: async () => true };
  const voiceDeps = {
    ...base,
    stt: vi.fn(() => null),
    holdMs: 0,
    allowUtterance: vi.fn(async () => true),
    chargeUtterance: vi.fn(async () => null),
  };
  return {
    dev,
    port,
    sdkToken,
    allowRead,
    voiceDeps,
    untouched: [...spies, ...linkerSpies, voiceDeps.stt, voiceDeps.allowUtterance, voiceDeps.chargeUtterance],
    plain: { menu: createMenuHandlers(menuDeps), voice: createVoiceHandlers(voiceDeps) },
    withSdk: { menu: createMenuHandlers({ ...menuDeps, sdk: port }), voice: createVoiceHandlers({ ...voiceDeps, sdk: port }) },
  };
}

type Handlers = ReturnType<typeof setup>["plain"];

const req = (method: string, path: string, token?: string, body?: unknown) => {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
};

/** Every device route the G2 plugin calls besides inbox/answer/dismiss/unpair (glasses-mcp `core/net/dopl.ts`, `device.ts`). */
const ROUTES: { name: string; call: (h: Handlers, token?: string) => Promise<Response> }[] = [
  { name: "home", call: (h, t) => h.menu.home(req("GET", "/home", t)) },
  { name: "agents", call: (h, t) => h.menu.agents(req("GET", `/channels/${OPS}/agents`, t), OPS) },
  { name: "messages", call: (h, t) => h.menu.messages(req("GET", `/channels/${OPS}/messages?limit=40`, t), OPS) },
  { name: "launch-options", call: (h, t) => h.menu.launchOptions(req("GET", `/launch-options?channel_id=${OPS}`, t)) },
  { name: "launch", call: (h, t) => h.menu.launch(req("POST", "/launch", t, { channel_id: OPS, runtime: "claude", model: "default" })) },
  { name: "launch status", call: (h, t) => h.menu.launchStatus(req("GET", `/launch/${MSG}?channel_id=${OPS}`, t), MSG) },
  { name: "target", call: (h, t) => h.menu.target(req("PUT", "/target", t, { channel_id: OPS })) },
  { name: "display answer", call: (h, t) => h.menu.displayAnswer(req("POST", `/channels/${OPS}/messages/${MSG}/display/answer`, t, { index: 0 }), OPS, MSG) },
  { name: "voice", call: (h, t) => h.voice.voice(new Request(`${BASE}/voice`, { method: "POST", headers: { authorization: `Bearer ${t}`, "content-type": "application/octet-stream" }, body: new Uint8Array(3200) })) },
];

const EXPECTED: Record<string, { status: number; body: unknown }> = {
  home: { status: 200, body: SDK_MENU.home },
  agents: { status: 404, body: { error: SDK_MENU.channelNotFound } },
  messages: { status: 404, body: { error: SDK_MENU.channelNotFound } },
  "launch-options": { status: 200, body: SDK_MENU.launchOptions },
  launch: { status: 403, body: { error: SDK_MENU.unsupported } },
  "launch status": { status: 404, body: { error: SDK_MENU.launchNotFound } },
  target: { status: 403, body: { error: SDK_MENU.unsupported } },
  "display answer": { status: 404, body: { error: SDK_MENU.channelNotFound } },
  voice: { status: 403, body: SDK_VOICE_REFUSAL },
};

describe("SDK G2 token on the menu and voice routes (A8b)", () => {
  it.each(ROUTES)("$name: never 401, the fixed shape, no gateway/linker/STT/meter touched", async ({ name, call }) => {
    const t = setup();
    const res = await call(t.withSdk, t.sdkToken);
    expect(res.status).not.toBe(401);
    expect({ status: res.status, body: await res.json() }).toEqual(EXPECTED[name]);
    for (const spy of t.untouched) expect(spy).not.toHaveBeenCalled();
    expect(t.port.deviceFromTokenHash).toHaveBeenCalledWith(hashCredential(t.sdkToken));
    expect(t.port.touch).toHaveBeenCalledWith(SDK_DEVICE, expect.any(String));
  });

  it("menu reads are rate limited by the SDK device id", async () => {
    const t = setup();
    await t.withSdk.menu.home(req("GET", "/home", t.sdkToken));
    expect(t.allowRead).toHaveBeenCalledWith(SDK_DEVICE);
  });

  it.each(ROUTES)("$name: an unknown token is still 401 (looked up once)", async ({ call }) => {
    const t = setup();
    const res = await call(t.withSdk, "glsdt_unknown");
    expect(res.status).toBe(401);
    expect(t.port.deviceFromTokenHash).toHaveBeenCalledTimes(1);
    for (const spy of t.untouched) expect(spy).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("$name: an SDK token without the port wired is 401 (prosumer-only deps)", async ({ call }) => {
    const t = setup();
    expect((await call(t.plain, t.sdkToken)).status).toBe(401);
  });
});

describe("🔒 prosumer answers are byte-identical with the SDK port wired", () => {
  async function prosumer(t: ReturnType<typeof setup>) {
    const d = await t.dev.devices.insertDevice({ userId: OWNER, name: "Lens", platform: "even_g2", now: "t" });
    await t.dev.devices.setTokenHash(d.id, hashCredential(PROSUMER_TOKEN));
  }

  it.each(ROUTES)("$name", async ({ call }) => {
    const a = setup();
    const b = setup();
    await prosumer(a);
    await prosumer(b);
    const [ra, rb] = [await call(a.plain, PROSUMER_TOKEN), await call(b.withSdk, PROSUMER_TOKEN)];
    expect(rb.status).toBe(ra.status);
    expect(await rb.text()).toBe(await ra.text());
    expect(b.port.deviceFromTokenHash).not.toHaveBeenCalled();
    expect(b.port.touch).not.toHaveBeenCalled();
  });

  it("the prosumer home really is the user's data (the pin is not vacuous)", async () => {
    const t = setup();
    await prosumer(t);
    const res = await t.withSdk.menu.home(req("GET", "/home", PROSUMER_TOKEN));
    expect(res.status).toBe(200);
    expect((await res.json()).channels.map((c: { id: string }) => c.id)).toEqual([OPS]);
  });

  it("prosumer voice still resolves its target and reaches STT (none configured here → 503)", async () => {
    const t = setup();
    await prosumer(t);
    const res = await t.withSdk.voice.voice(new Request(`${BASE}/voice`, { method: "POST", headers: { authorization: `Bearer ${PROSUMER_TOKEN}` }, body: new Uint8Array(3200) }));
    expect(res.status).toBe(503);
    expect(t.voiceDeps.stt).toHaveBeenCalled();
  });
});
