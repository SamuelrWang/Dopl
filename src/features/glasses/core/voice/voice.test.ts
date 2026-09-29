import { describe, expect, it, vi } from "vitest";
import { createFakeChannel } from "../testing/fake-channel";
import { fakeLinker } from "../testing/fake-device-store";
import { fakeClock } from "../testing/fake-store";
import { isNearSilent, pcmToWav, type SttProvider } from "./stt";
import { resolveVoiceTarget, targetOverrideFrom } from "./target";
import { handleVoiceUpload } from "./upload";
import { handleGlassesUtterance, replyHoldMsFromEnv } from "./utterance";

const USER = "11111111-1111-4111-8111-111111111111";
const CHANNEL = { channelId: "chan", containerId: "ws", name: "AI Glasses" };
const SOURCE = { kind: "glasses" as const, device_id: "dev-1", label: "Even G2", platform: "even_g2" };
const CONFIG = { channel: CHANNEL, operatorUserId: USER, agentId: "abcdefgh", source: SOURCE };

function tone(ms: number, amplitude: number): Uint8Array {
  const n = Math.round((16_000 * ms) / 1000);
  const buf = new Uint8Array(n * 2);
  const v = new DataView(buf.buffer);
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(amplitude * Math.sin(i / 5)), true);
  return buf;
}

describe("handleGlassesUtterance", () => {
  it("returns the agent's reply when it lands inside the hold", async () => {
    const ch = createFakeChannel();
    const clock = fakeClock();
    let ticks = 0;
    let replyId = "";
    clock.onSleep(() => {
      if (++ticks === 3) replyId = ch.agentSays("pong", "Orchestrator");
    });
    const res = await handleGlassesUtterance(
      { gateway: ch.gateway, config: CONFIG, now: clock.now, sleep: clock.sleep },
      "  reply with pong ",
    );
    expect(ch.messages[0]).toMatchObject({ body: "reply with pong", author: "user", source: SOURCE });
    expect(res).toEqual({
      status: "replied",
      channel_message_id: ch.messages[0].id,
      addressed_to: "agent-abcdefgh",
      addressed_name: "Orchestrator",
      channel_name: "AI Glasses",
      reply: "pong",
      reply_message_id: replyId,
      agent: "Orchestrator",
    });
  });

  it("gives up after the 6s hold (post included) and returns sent", async () => {
    const ch = createFakeChannel();
    const clock = fakeClock();
    const start = clock.now();
    const res = await handleGlassesUtterance(
      { gateway: ch.gateway, config: CONFIG, now: clock.now, sleep: clock.sleep, holdMs: 6000 },
      "hi",
    );
    expect(res).toMatchObject({ status: "sent", addressed_name: "Orchestrator" });
    expect(clock.now() - start).toBeLessThanOrEqual(6000);
    expect(clock.now() - start).toBeGreaterThanOrEqual(5500);
  });

  it("reads the hold from GLASSES_REPLY_HOLD_MS, capped at 6s", () => {
    expect(replyHoldMsFromEnv({})).toBe(6000);
    expect(replyHoldMsFromEnv({ GLASSES_REPLY_HOLD_MS: "3000" })).toBe(3000);
    expect(replyHoldMsFromEnv({ GLASSES_REPLY_HOLD_MS: "0" })).toBe(0);
    expect(replyHoldMsFromEnv({ GLASSES_REPLY_HOLD_MS: "60000" })).toBe(6000);
    expect(replyHoldMsFromEnv({ GLASSES_REPLY_HOLD_MS: "abc" })).toBe(6000);
  });

  it("returns offline when no agent is live", async () => {
    const ch = createFakeChannel({ liveAgents: 0 });
    const sleep = vi.fn();
    const res = await handleGlassesUtterance({ gateway: ch.gateway, config: { ...CONFIG, agentId: null }, sleep }, "hi");
    expect(res).toMatchObject({ status: "offline", addressed_to: null, channel_name: "AI Glasses" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("routes to the explicit override, then the current target, then the most recent channel", async () => {
    const A = "aaaaaaaa-0000-4000-8000-000000000000";
    const B = "bbbbbbbb-0000-4000-8000-000000000000";
    const C = "cccccccc-0000-4000-8000-000000000000";
    const gone = "dddddddd-0000-4000-8000-000000000000";
    const linker = fakeLinker({
      [A]: { name: "a", members: [USER], last: "2026-09-01" },
      [B]: { name: "b", members: [USER], last: "2026-09-02" },
      [C]: { name: "c", members: [USER], last: "2026-09-03" },
    });
    const device = { user_id: USER, current_target_channel_id: B, current_target_agent: "abcdefgh" };
    const link = (channelId: string, name: string) => ({ channelId, containerId: "11111111-0000-4000-8000-000000000000", name });
    expect(await resolveVoiceTarget(linker, device, { channelId: A, agentId: null })).toEqual({ channel: link(A, "a"), agentId: null, source: "override" });
    expect(await resolveVoiceTarget(linker, device, null)).toEqual({ channel: link(B, "b"), agentId: "abcdefgh", source: "current" });
    // A stale / foreign override and target fall through to the most recently active channel, unaddressed.
    expect(await resolveVoiceTarget(linker, { ...device, current_target_channel_id: gone }, { channelId: gone })).toEqual({
      channel: link(C, "c"),
      agentId: null,
      source: "recent",
    });
    expect(await resolveVoiceTarget(linker, { ...device, current_target_channel_id: null }, null)).toMatchObject({ source: "recent" });
    // No usable channel at all: no target (the handler answers "Open a channel on your glasses first").
    expect(await resolveVoiceTarget(fakeLinker({ [A]: { name: "a", members: ["someone-else"] } }), device, null)).toBeNull();
    const req = new Request(`http://x/api/glasses/device/voice?channel_id=${A}&agent=bad-id`);
    expect(targetOverrideFrom(req)).toEqual({ channelId: A, agentId: "bad-id" });
    expect(await resolveVoiceTarget(linker, device, targetOverrideFrom(req))).toMatchObject({ channel: { channelId: A }, agentId: null });
  });

  it("does not consult the fallback when the current target is usable", async () => {
    const B = "bbbbbbbb-0000-4000-8000-000000000000";
    const linker = fakeLinker({ [B]: { name: "b", members: [USER] } });
    const mostRecent = vi.spyOn(linker, "mostRecent");
    await resolveVoiceTarget(linker, { user_id: USER, current_target_channel_id: B, current_target_agent: null }, null);
    expect(mostRecent).not.toHaveBeenCalled();
  });

  it("reports the stored post to onPosted, and a failing hook never fails the utterance", async () => {
    const ch = createFakeChannel({ liveAgents: 0 });
    const seen: number[] = [];
    const res = await handleGlassesUtterance(
      { gateway: ch.gateway, config: CONFIG, onPosted: async (seq) => void seen.push(seq) },
      "hi",
    );
    expect(seen).toEqual([ch.messages[0].seq]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await handleGlassesUtterance(
      { gateway: ch.gateway, config: CONFIG, onPosted: async () => Promise.reject(new Error("db down")) },
      "hi again",
    );
    err.mockRestore();
    expect(res.status).toBe("offline");
    expect(again.status).toBe("offline");
  });
});

describe("voice upload", () => {
  const stt = (text: string): SttProvider => ({ name: "mock", transcribe: vi.fn(async () => text) });

  it("wraps PCM as a 16 kHz mono WAV", () => {
    const wav = pcmToWav(new Uint8Array(3200));
    const v = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(40, true)).toBe(3200);
  });

  it("returns empty for silence without calling STT", async () => {
    const provider = stt("x");
    const ch = createFakeChannel();
    expect(isNearSilent(tone(2000, 20))).toBe(true);
    expect(await handleVoiceUpload({ stt: provider, utterance: { gateway: ch.gateway, config: CONFIG } }, tone(2000, 20))).toEqual({
      status: "empty",
      transcript: "",
    });
    expect(provider.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes, posts and returns the channel outcome", async () => {
    const ch = createFakeChannel({ liveAgents: 0 });
    const res = await handleVoiceUpload(
      { stt: stt("what is the status"), utterance: { gateway: ch.gateway, config: CONFIG } },
      tone(1000, 8000),
    );
    expect(res).toMatchObject({ transcript: "what is the status", status: "offline" });
    expect(ch.messages[0].body).toBe("what is the status");
  });

  it("rejects oversize and odd-length audio", async () => {
    const ch = createFakeChannel();
    const deps = { stt: stt("x"), utterance: { gateway: ch.gateway, config: CONFIG } };
    await expect(handleVoiceUpload(deps, new Uint8Array(3))).rejects.toMatchObject({ httpStatus: 400 });
    await expect(handleVoiceUpload(deps, new Uint8Array(16_000 * 2 * 70))).rejects.toMatchObject({ httpStatus: 413 });
  });
});
