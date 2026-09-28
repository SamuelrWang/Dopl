import { describe, expect, it, vi } from "vitest";
import { createHeyEvenHandlers, heyEvenBaseUrl } from "../platforms/even-g2/hey-even";
import { hashCredential } from "./devices/credentials";
import { startPairing } from "./devices/pairing";
import { glassesSessionOnly } from "./devices/session-policy";
import { createUserHandlers } from "./devices/user-handlers";
import { createDeviceHandlers } from "./messages/device-handlers";
import { glassesNotify } from "./messages/service";
import { createFakeChannel } from "./testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "./testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "./testing/fake-store";
import type { SttProvider } from "./voice/stt";
import { createVoiceHandlers } from "./voice/handlers";

const OWNER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "33333333-3333-4333-8333-333333333333";
const BASE = "http://127.0.0.1:3100";

function setup(opts: { allowPairStart?: boolean; allowClaim?: boolean; allowUtterance?: boolean; refuse?: string } = {}) {
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
  const voiceDeps = {
    ...deps,
    stt: () => stt,
    holdMs: 0,
    allowUtterance: async () => opts.allowUtterance ?? true,
    chargeUtterance: async () => opts.refuse ?? null,
  };
  return {
    ...msgs,
    ...dev,
    ch,
    clock,
    linker,
    device: createDeviceHandlers(deps),
    voice: createVoiceHandlers(voiceDeps),
    heyEven: createHeyEvenHandlers(voiceDeps),
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
    await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${start.pair_id}`, { token: start.poll_secret }))
  ).json();
  return { token: status.device_token as string, id: status.device_id as string };
}

describe("device API", () => {
  it("pairs end to end, then authenticates the inbox with the device token", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    await glassesNotify({ store: t.store, devices: t.devices }, OWNER, { title: "Hi", body: "there" });
    const res = await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token, headers: { origin: "https://even.example" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
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

  it("unpairs the calling device, which then 401s", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    const res = await t.device.unpair(req("/api/glasses/device/unpair", { method: "POST", token }));
    expect(await res.json()).toEqual({ ok: true });
    expect(t.deviceRows.find((d) => d.id === id)?.revoked_at).not.toBeNull();
    expect((await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }))).status).toBe(401);
    expect((await t.device.unpair(req("/api/glasses/device/unpair", { method: "POST", token }))).status).toBe(401);
  });

  it("writes last_seen at most once per 30s per device", async () => {
    const t = setup();
    const { token } = await pair(t);
    const touch = vi.spyOn(t.devices, "touchDevice");
    for (let i = 0; i < 3; i++) await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }));
    expect(touch).toHaveBeenCalledTimes(1);
    t.clock.advance(31_000);
    await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }));
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it("runs the reply mirror at most once per 5s per device, and mirrors agent replies", async () => {
    const t = setup();
    const { token } = await pair(t);
    const linkable = vi.spyOn(t.linker, "linkable");
    await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }));
    await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }));
    expect(linkable).toHaveBeenCalledTimes(1);
    t.ch.agentSays("pong", "Orchestrator");
    t.clock.advance(5_000);
    const body = await (await t.device.inbox(req("/api/glasses/device/inbox?wait=0", { token }))).json();
    expect(linkable).toHaveBeenCalledTimes(2);
    expect(body.messages).toEqual([expect.objectContaining({ kind: "show", payload: { title: "Orchestrator", lines: ["pong"], channel_id: CHANNEL, agent_session_id: "abcdefgh" } })]);
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
    expect((await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${s.pair_id}`, { token: "bad" }))).status).toBe(404);
    // The secret is read from the header only: the query form (logged by proxies) is refused.
    const viaQuery = await t.device.pairStatus(req(`/api/glasses/device/pair/status?pair_id=${s.pair_id}&poll_secret=${s.poll_secret}`));
    expect(viaQuery.status).toBe(400);
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

  it("rate-limits and meters utterances", async () => {
    const limited = setup({ allowUtterance: false });
    const a = await pair(limited);
    expect((await limited.voice.voice(req("/api/glasses/device/voice", { method: "POST", body: pcm(), token: a.token }))).status).toBe(429);

    const broke = setup({ refuse: "Your Dopl credits are used up for this period." });
    const b = await pair(broke);
    const res = await broke.voice.voice(req("/api/glasses/device/voice", { method: "POST", body: pcm(), token: b.token }));
    expect(res.status).toBe(402);
    expect(broke.ch.messages).toHaveLength(0);
  });

  it("refuses oversize audio by Content-Length before reading it", async () => {
    const t = setup();
    const { token } = await pair(t);
    const big = req("/api/glasses/device/voice", { method: "POST", body: "x", token, headers: { "content-length": String(5_000_000) } });
    expect((await t.voice.voice(big)).status).toBe(413);
  });

  it("409s voice from an unlinked device", async () => {
    const t = setup();
    const { token } = await pair(t, null);
    expect((await t.voice.voice(req("/api/glasses/device/voice", { method: "POST", body: pcm(), token }))).status).toBe(409);
  });

  it("authenticates Hey Even by the rotated per-device key, never the device token", async () => {
    const t = setup();
    const { token, id } = await pair(t);
    const rotated = await (await t.heyEven.rotateKey(post(`/api/glasses/devices/${id}/hey-even-key`, {}), OWNER, id)).json();
    expect(rotated.key).toMatch(/^glshe_/);
    expect(rotated.url).toBe(`${BASE}/api/glasses/hey-even/v1/chat/completions`);
    expect(t.deviceRows[0].hey_even_key_hash).toBe(hashCredential(rotated.key));

    const body = { messages: [{ role: "user", content: "reply with pong" }] };
    expect((await t.heyEven.completions(post("/api/glasses/hey-even/v1/chat/completions", body, token))).status).toBe(401);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await t.heyEven.completions(post("/api/glasses/hey-even/v1/chat/completions", body, rotated.key));
    expect(JSON.stringify(log.mock.calls)).not.toContain(rotated.key);
    log.mockRestore();
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toBe("Sent to AI Glasses.");
    expect(t.ch.messages.at(-1)?.body).toBe("reply with pong");

    const models = await t.heyEven.models(req("/api/glasses/hey-even/v1/models", { token: rotated.key }));
    expect((await models.json()).data[0].id).toBe("dopl-glasses");
    const again = await (await t.heyEven.rotateKey(post(`/api/glasses/devices/${id}/hey-even-key`, {}), OWNER, id)).json();
    expect((await t.heyEven.models(req("/api/glasses/hey-even/v1/models", { token: rotated.key }))).status).toBe(401);
    expect((await t.heyEven.models(req("/api/glasses/hey-even/v1/models", { token: again.key }))).status).toBe(200);
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

  it("404s a Hey Even key rotation for an unknown or revoked device", async () => {
    const t = setup();
    const { id } = await pair(t);
    await t.user.revoke(OWNER, id);
    expect((await t.heyEven.rotateKey(post(`/api/glasses/devices/${id}/hey-even-key`, {}), OWNER, id)).status).toBe(404);
  });

  it("builds the Hey Even URL from configuration, never from forwarded headers", () => {
    const r = new Request("http://internal:3000/x", { headers: { "x-forwarded-host": "evil.test" } });
    expect(heyEvenBaseUrl(r, { GLASSES_API_BASE_URL: "https://www.usedopl.com/" })).toBe("https://www.usedopl.com");
    expect(heyEvenBaseUrl(r, { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://usedopl.com" })).toBe("https://usedopl.com");
    expect(heyEvenBaseUrl(r, { NODE_ENV: "development", NEXT_PUBLIC_APP_URL: "https://usedopl.com" })).toBe("http://internal:3000");
  });

  it("is session-only unless a non-production dev server opts agent tokens in", () => {
    expect(glassesSessionOnly({ NODE_ENV: "production", GLASSES_DEV_AGENT_TOKENS: "1" })).toBe(true);
    expect(glassesSessionOnly({ NODE_ENV: "development" })).toBe(true);
    expect(glassesSessionOnly({ NODE_ENV: "development", GLASSES_DEV_AGENT_TOKENS: "1" })).toBe(false);
  });

  it("rate-limits claims per user", async () => {
    const t = setup({ allowClaim: false });
    expect((await t.user.claim(post("/api/glasses/pair/claim", { code: "ABCDEF" }), OWNER)).status).toBe(429);
  });
});
