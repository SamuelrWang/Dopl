import { describe, expect, it, vi } from "vitest";
import { hashCredential } from "./credentials";
import { createDeviceHandlers } from "./device-handlers";
import { createFakeDeviceStore, fakeLinker } from "./fake-device-store";
import { createFakeGlassesStore, fakeClock } from "./fake-store";
import { startPairing } from "./pairing-service";
import { glassesNotify } from "./service";
import type { SttProvider } from "./stt";
import { createUserHandlers } from "./user-handlers";
import { createVoiceHandlers } from "./voice-handlers";
import { createFakeChannel } from "./voice-test-kit";

const OWNER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";
const BASE = "http://127.0.0.1:3100";

function setup(opts: { allowPairStart?: boolean; allowClaim?: boolean } = {}) {
  const msgs = createFakeGlassesStore();
  const dev = createFakeDeviceStore();
  const clock = fakeClock();
  const ch = createFakeChannel({ liveAgents: 1 });
  const linker = fakeLinker({ [CHANNEL]: { name: "AI Glasses", members: [OWNER] } });
  const deps = {
    store: msgs.store,
    devices: dev.devices,
    gateway: ch.gateway,
    linker,
    allowPairStart: vi.fn(async () => opts.allowPairStart ?? true),
    now: clock.now,
    sleep: clock.sleep,
  };
  const stt: SttProvider = { name: "mock", transcribe: vi.fn(async () => "what is the status") };
  return {
    ...msgs,
    ...dev,
    ch,
    clock,
    device: createDeviceHandlers(deps),
    voice: createVoiceHandlers({ ...deps, stt: () => stt, holdMs: 0 }),
    user: createUserHandlers({ devices: dev.devices, linker, allowClaim: async () => opts.allowClaim ?? true, now: clock.now }),
  };
}

const req = (path: string, init: RequestInit & { token?: string } = {}) => {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
};
const post = (path: string, body: unknown, token?: string) =>
  req(path, { method: "POST", body: JSON.stringify(body), token, headers: { "content-type": "application/json" } });

/** Pair a device through the real handlers; returns its token and id. */
async function pair(t: ReturnType<typeof setup>, channel: string | null = CHANNEL) {
  const start = await (await t.device.pairStart(req("/api/glasses/device/pair/start", { method: "POST" }))).json();
  const claim = await t.user.claim(post("/api/glasses/pair/claim", { code: start.code, channel_id: channel }), OWNER);
  expect(claim.status).toBe(201);
  const status = await (
    await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${start.pair_id}&poll_secret=${start.poll_secret}`))
  ).json();
  return { token: status.device_token as string, id: status.device_id as string };
}

describe("device API", () => {
  it("pairs end to end, then authenticates the inbox with the device token", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    await glassesNotify({ store: t.store, devices: t.devices }, OWNER, { title: "Hi", body: "there" });
    const res = await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token, headers: { origin: "http://127.0.0.1:5180" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5180");
    const body = await res.json();
    expect(body.messages).toHaveLength(1);
    expect(t.deviceRows.find((d) => d.id === id)?.last_seen).not.toBeNull();
  });

  it("401s a missing, wrong or revoked device token", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    expect((await t.device.inbox(req("/api/glasses/device/inbox?wait=0"))).status).toBe(401);
    expect((await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token: "glsdt_nope" }))).status).toBe(401);
    expect((await t.user.revoke(OWNER, id)).status).toBe(200);
    expect((await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }))).status).toBe(401);
    expect((await t.device.answer(post("/api/glasses/device/answer", { id: "x" }, token))).status).toBe(401);
  });

  it("rate-limits pairing starts with 429", async () => {
    const t = setup({ allowPairStart: false });
    const res = await t.device.pairStart(req("/api/glasses/device/pair/start", { method: "POST" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("validates pairing status input", async () => {
    const t = setup();
    expect((await t.device.pairStatus(req("/api/glasses/device/pair/status"))).status).toBe(400);
    const s = await startPairing({ devices: t.devices, linker: fakeLinker({}) });
    expect((await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${s.pair_id}&poll_secret=bad`))).status).toBe(404);
    // The header form keeps the secret out of access logs.
    const viaHeader = await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${s.pair_id}`, { token: s.poll_secret }));
    expect(await viaHeader.json()).toMatchObject({ status: "pending" });
  });

  it("answers and dismisses on the owner's queue; bad JSON is 400", async () => {
    const t = setup();
    const { token } = await pair(t);
    const n = await glassesNotify({ store: t.store, devices: t.devices }, OWNER, { title: "t", body: "b" });
    expect((await t.device.dismiss(post("/api/glasses/device/dismiss", { id: n.id }, token))).status).toBe(200);
    const bad = req("/api/glasses/device/answer", { method: "POST", body: "{", token });
    expect((await t.device.answer(bad)).status).toBe(400);
  });
});

describe("voice + Hey Even", () => {
  const pcm = () => {
    const buf = new Uint8Array(32_000);
    const v = new DataView(buf.buffer);
    for (let i = 0; i < 16_000; i++) v.setInt16(i * 2, Math.round(8000 * Math.sin(i / 5)), true);
    return buf;
  };

  it("posts a voice utterance into the device's linked channel as its owner", async () => {
    const t = setup();
    const { token } = await pair(t);
    const res = await t.voice.voice(req("/api/glasses/device/voice", { method: "POST", body: pcm(), token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transcript: "what is the status", status: "sent" });
    expect(t.ch.messages[0].body).toBe("what is the status");
  });

  it("409s voice from an unlinked device", async () => {
    const t = setup();
    const { token } = await pair(t, null);
    expect((await t.voice.voice(req("/api/glasses/device/voice", { method: "POST", body: pcm(), token }))).status).toBe(409);
  });

  it("authenticates Hey Even by the rotated per-device key, never the device token", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    const rotated = await (await t.user.rotateHeyEvenKey(post(`/api/glasses/devices/${id}/hey-even-key`, {}), OWNER, id)).json();
    expect(rotated.key).toMatch(/^glshe_/);
    expect(rotated.url).toBe(`${BASE}/api/glasses/hey-even/v1/chat/completions`);
    expect(t.deviceRows[0].hey_even_key_hash).toBe(hashCredential(rotated.key));

    const body = { messages: [{ role: "user", content: "reply with pong" }] };
    expect((await t.voice.heyEven(post("/api/glasses/hey-even/v1/chat/completions", body, token))).status).toBe(401);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await t.voice.heyEven(post("/api/glasses/hey-even/v1/chat/completions", body, rotated.key));
    expect(JSON.stringify(log.mock.calls)).not.toContain(rotated.key);
    log.mockRestore();
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("Sent to Orchestrator. Reply coming to your glasses.");
    expect(t.ch.messages.at(-1)?.body).toBe("reply with pong");

    const models = await t.voice.models(req("/api/glasses/hey-even/v1/models", { token: rotated.key }));
    expect((await models.json()).data[0].id).toBe("dopl-glasses");
    const again = await (await t.user.rotateHeyEvenKey(post(`/api/glasses/devices/${id}/hey-even-key`, {}), OWNER, id)).json();
    expect((await t.voice.models(req("/api/glasses/hey-even/v1/models", { token: rotated.key }))).status).toBe(401);
    expect((await t.voice.models(req("/api/glasses/hey-even/v1/models", { token: again.key }))).status).toBe(200);
  });
});

describe("user API", () => {
  it("lists, renames, relinks and revokes devices", async () => {
    const t = setup();
    const { id } = await pair(t);
    const list = await (await t.user.list(OWNER)).json();
    expect(list.devices).toEqual([
      expect.objectContaining({ id, name: "Even G2", online: false, last_seen: null, linked_channel: { id: CHANNEL, name: "AI Glasses" }, has_hey_even_key: false }),
    ]);
    const renamed = await t.user.patch(req(`/api/glasses/devices/${id}`, { method: "PATCH", body: JSON.stringify({ name: "Lens", channel_id: null }) }), OWNER, id);
    expect((await renamed.json()).device).toMatchObject({ name: "Lens", linked_channel: null });
    expect(t.deviceRows[0].reply_cursor_seq).toBeNull();
    expect((await t.user.list("someone-else").then((r) => r.json())).devices).toEqual([]);
    expect((await t.user.revoke(OWNER, id)).status).toBe(200);
    expect((await t.user.revoke(OWNER, id)).status).toBe(404);
  });

  it("validates bodies and channel membership", async () => {
    const t = setup();
    const { id } = await pair(t);
    const patch = (body: unknown) => t.user.patch(req(`/api/glasses/devices/${id}`, { method: "PATCH", body: JSON.stringify(body) }), OWNER, id);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: "" })).status).toBe(400);
    expect((await patch({ channel_id: "not-a-uuid" })).status).toBe(400);
    expect((await patch({ channel_id: "55555555-5555-4555-8555-555555555555" })).status).toBe(404);
    expect((await t.user.claim(post("/api/glasses/pair/claim", { name: "x" }), OWNER)).status).toBe(400);
    expect((await t.user.patch(req("/api/glasses/devices/zzz", { method: "PATCH", body: '{"name":"a"}' }), OWNER, "zzz")).status).toBe(404);
  });

  it("rate-limits claims per user", async () => {
    const t = setup({ allowClaim: false });
    expect((await t.user.claim(post("/api/glasses/pair/claim", { code: "ABCDEF" }), OWNER)).status).toBe(429);
  });
});
