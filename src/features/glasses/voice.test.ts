import { describe, expect, it, vi } from "vitest";
import { createFakeGlassesStore, fakeClock } from "./fake-store";
import { mirrorReplies, replyToGlasses, wrapLines } from "./reply-mirror";
import { flattenForG2, plainReply } from "./g2-text";
import { isNearSilent, pcmToWav, type SttProvider } from "./stt";
import {
  assistantText,
  chatCompletion,
  chatCompletionStream,
  handleVoiceUpload,
  lastUserText,
  modelList,
  redactedHeaders,
} from "./voice";
import { createFakeChannel } from "./voice-test-kit";
import { handleGlassesUtterance, replyHoldMsFromEnv } from "./voice-utterance";
import { resolveVoiceTarget, targetOverrideFrom } from "./voice-target";
import { createFakeDeviceStore, fakeLinker } from "./fake-device-store";
import type { ShowPayload } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const CONFIG = { channelId: "chan", operatorUserId: USER, agentId: "abcdefgh" };

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
    expect(ch.messages[0]).toMatchObject({ body: "reply with pong", author: "user" });
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

  it("routes to the explicit override, then the current target, then the linked channel", async () => {
    const A = "aaaaaaaa-0000-4000-8000-000000000000";
    const B = "bbbbbbbb-0000-4000-8000-000000000000";
    const C = "cccccccc-0000-4000-8000-000000000000";
    const gone = "dddddddd-0000-4000-8000-000000000000";
    const linker = fakeLinker({ [A]: { name: "a", members: [USER] }, [B]: { name: "b", members: [USER] }, [C]: { name: "c", members: [USER] } });
    const device = { user_id: USER, linked_channel_id: C, current_target_channel_id: B, current_target_agent: "abcdefgh" };
    expect(await resolveVoiceTarget(linker, device, { channelId: A, agentId: null })).toEqual({ channelId: A, agentId: null, source: "override" });
    expect(await resolveVoiceTarget(linker, device, null)).toEqual({ channelId: B, agentId: "abcdefgh", source: "current" });
    expect(await resolveVoiceTarget(linker, { ...device, current_target_channel_id: gone }, { channelId: gone })).toEqual({
      channelId: C,
      agentId: null,
      source: "linked",
    });
    expect(await resolveVoiceTarget(linker, { ...device, current_target_channel_id: null, linked_channel_id: null }, null)).toBeNull();
    const req = new Request(`http://x/api/glasses/device/voice?channel_id=${A}&agent=bad-id`);
    expect(targetOverrideFrom(req)).toEqual({ channelId: A, agentId: "bad-id" });
    expect(await resolveVoiceTarget(linker, device, targetOverrideFrom(req))).toMatchObject({ channelId: A, agentId: null });
  });
});

describe("reply mirror", () => {
  async function linkedDevice(devices: ReturnType<typeof createFakeDeviceStore>["devices"], channel: string | null = "chan") {
    return devices.insertDevice({ userId: USER, name: "Lens", platform: "even_g2", linkedChannelId: channel, linkedContainerId: null, now: "t" });
  }

  it("starts at the channel head, then mirrors each agent reply exactly once", async () => {
    const { store, rows } = createFakeGlassesStore();
    const { devices, deviceRows } = createFakeDeviceStore();
    const ch = createFakeChannel();
    ch.agentSays("old history, never replayed");
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ chan: { name: "Room", members: [USER] } }) };
    const device = await linkedDevice(devices);
    const first = await mirrorReplies(deps, device);
    expect(first).toEqual({ queued: 0, cursor: 101 });
    expect(deviceRows[0].reply_cursor_seq).toBe(101);
    const id = ch.agentSays("Build is **green**. Deploying now.");
    const second = await mirrorReplies(deps, { ...device, reply_cursor_seq: first.cursor });
    expect(second).toEqual({ queued: 1, cursor: 102 });
    expect(await mirrorReplies(deps, { ...device, reply_cursor_seq: second.cursor })).toEqual({ queued: 0, cursor: 102 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "show",
      card_id: `reply-${id}`,
      user_id: USER,
      payload: { title: "Coder", lines: ["Build is green. Deploying now."], channel_id: "chan", agent_session_id: "abcdefgh" },
    });
    expect(Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at)).toBe(600_000);
  });

  it("is idempotent even if the cursor is rewound, and ignores unlinked devices", async () => {
    const { store, rows } = createFakeGlassesStore();
    const { devices } = createFakeDeviceStore();
    const ch = createFakeChannel();
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ chan: { name: "Room", members: [USER] } }) };
    const device = await linkedDevice(devices);
    const { cursor } = await mirrorReplies(deps, device);
    ch.agentSays("one");
    await mirrorReplies(deps, { ...device, reply_cursor_seq: cursor });
    await mirrorReplies(deps, { ...device, reply_cursor_seq: cursor });
    expect(rows).toHaveLength(1);
    const unlinked = await linkedDevice(devices, null);
    expect(await mirrorReplies(deps, unlinked)).toEqual({ queued: 0, cursor: null });
  });

  it("unlinks the device and reads nothing once the owner can no longer see the channel", async () => {
    const { store, rows } = createFakeGlassesStore();
    const { devices, deviceRows } = createFakeDeviceStore();
    const ch = createFakeChannel();
    const room = { name: "Room", members: [USER] };
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ chan: room }) };
    const device = await linkedDevice(devices);
    const { cursor } = await mirrorReplies(deps, device);
    room.members = [];
    ch.agentSays("after departure");
    expect(await mirrorReplies(deps, { ...device, reply_cursor_seq: cursor })).toEqual({ queued: 0, cursor: null, unlinked: true });
    expect(rows).toHaveLength(0);
    expect(deviceRows[0].linked_channel_id).toBeNull();
  });

  it("mirrors even a one-word reply as a show card (it must not auto-dismiss)", () => {
    expect(replyToGlasses({ agentName: "Orchestrator", body: "pong" })).toEqual({
      kind: "show",
      payload: { title: "Orchestrator", lines: ["pong"] },
    });
  });

  it("turns a long reply into a clamped show card", () => {
    const msg = replyToGlasses({ agentName: "Coder \u{1F916}", body: "word ".repeat(200) });
    expect(msg?.kind).toBe("show");
    const p = msg!.payload as ShowPayload;
    expect(p.title).toBe("Coder");
    expect(p.lines).toHaveLength(4);
    expect(p.lines[3].endsWith("…")).toBe(true);
    for (const l of p.lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(100);
  });

  it("flattens markdown and wraps without cutting short text", () => {
    expect(plainReply("# Title\n- one\n- `two`\n[link](http://x)")).toBe("Title - one - two link");
    expect(flattenForG2("See ![chart](https://x/c.png) and [Q3 report](https://x/q3.pdf).")).toEqual({
      text: "See [image] and [file: Q3 report] .",
      notes: ["[image]", "[file: Q3 report]"],
    });
    expect(wrapLines("short reply")).toEqual(["short reply"]);
    expect(replyToGlasses({ agentName: "A", body: "\u{1F600}" })).toBeNull();
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

describe("hey-even shim", () => {
  it("takes the last user message, string or parts", () => {
    expect(lastUserText({ messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }] })).toBe("c");
    expect(lastUserText({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url" }] }] })).toBe("hi");
    expect(lastUserText({})).toBeNull();
  });

  it("answers in chat.completion shape", () => {
    const res = chatCompletion("pong", "chatcmpl-1", 1);
    expect(res).toMatchObject({
      object: "chat.completion",
      model: "dopl-glasses",
      choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
    });
    const sse = chatCompletionStream("pong", "chatcmpl-1", 1);
    expect(sse.trim().split("\n\n")).toHaveLength(3);
    expect(sse.endsWith("data: [DONE]\n\n")).toBe(true);
    expect(modelList(1).data[0].id).toBe("dopl-glasses");
  });

  it("says which agent it went to, by display name when there is one", () => {
    const base = { status: "sent" as const, channel_message_id: "m", addressed_to: "agent-abcdefgh" };
    expect(assistantText({ ...base, addressed_name: "Orchestrator" })).toBe("Sent to Orchestrator.");
    expect(assistantText({ ...base, addressed_name: null })).toBe("Sent to @agent-abcdefgh.");
    expect(assistantText({ status: "sent", channel_message_id: "m", addressed_to: null, channel_name: "Ops" })).toBe("Sent to Ops.");
    expect(assistantText({ status: "sent", channel_message_id: "m", addressed_to: null })).toBe(
      "Sent to your Dopl channel.",
    );
    expect(assistantText({ ...base, status: "replied", reply: "pong", reply_message_id: "r" })).toBe("pong");
  });

  it("redacts credentials in the header log", () => {
    const h = redactedHeaders(new Headers({ authorization: "Bearer x", "user-agent": "EvenApp/1", cookie: "a=b" }));
    expect(h).toEqual({ authorization: "[redacted]", "user-agent": "EvenApp/1", cookie: "[redacted]" });
  });
});
