import { describe, expect, it, vi } from "vitest";
import { evenG2 } from "../../platforms/even-g2";
import { createFakeChannel } from "../testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "../testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { CURSOR_STALE_MS, POST_SCOPE_MS, mirrorReplies, recordDevicePost, replyToGlasses } from "./reply-mirror";
import type { ShowPayload } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const CHAN = "22222222-2222-4222-8222-222222222222";

describe("reply mirror", () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";

  function setup(rooms: Record<string, { name: string; members: string[] }> = { [CHAN]: { name: "Room", members: [USER] }, [OTHER]: { name: "Other", members: [USER] } }) {
    const glasses = createFakeGlassesStore();
    const dev = createFakeDeviceStore();
    const ch = createFakeChannel();
    const clock = fakeClock();
    const linker = fakeLinker(rooms);
    const deps = { store: glasses.store, devices: dev.devices, gateway: ch.gateway, linker, now: clock.now };
    return { ...glasses, ...dev, ch, clock, linker, deps };
  }
  async function device(t: ReturnType<typeof setup>, target: string | null = CHAN) {
    const d = await t.devices.insertDevice({ userId: USER, name: "Lens", platform: "even_g2", now: "t" });
    return { ...d, current_target_channel_id: target };
  }
  const cursorOf = (t: ReturnType<typeof setup>, deviceId: string, channelId: string) => t.activity.get(`${deviceId}|${channelId}`)?.reply_cursor_seq;

  it("starts the target channel at its head, then mirrors each agent reply exactly once", async () => {
    const t = setup();
    t.ch.agentSays("old history, never replayed", "Coder", CHAN);
    const d = await device(t);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [CHAN] });
    expect(cursorOf(t, d.id, CHAN)).toBe(101);
    const id = t.ch.agentSays("Build is **green**. Deploying now.", "Coder", CHAN);
    t.clock.advance(5_000);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 1, channels: [CHAN] });
    t.clock.advance(5_000);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [CHAN] });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({
      kind: "show",
      card_id: `reply-${id}`,
      user_id: USER,
      payload: { title: "Coder", lines: ["Build is green. Deploying now."], channel_id: CHAN, agent_session_id: "abcdefgh" },
    });
    expect(Date.parse(t.rows[0].expires_at) - Date.parse(t.rows[0].created_at)).toBe(600_000);
  });

  it("mirrors a posted-to channel for 24h from the post's seq, even before the first pass", async () => {
    const t = setup();
    t.ch.agentSays("before the post, never replayed", "Coder", OTHER);
    const d = await device(t, null);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [] });
    await recordDevicePost(t.deps, d.id, OTHER, 101);
    t.ch.agentSays("answer to your question", "Coder", OTHER);
    expect(await mirrorReplies(t.deps, d)).toMatchObject({ queued: 1, channels: [OTHER] });
    expect(t.rows.map((r) => r.payload)).toEqual([expect.objectContaining({ lines: ["answer to your question"], channel_id: OTHER })]);
    // 24h after the last post, with no target there, the channel leaves scope.
    t.clock.advance(POST_SCOPE_MS + 1);
    t.ch.agentSays("much later", "Coder", OTHER);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [] });
    expect(t.rows).toHaveLength(1);
  });

  it("reads the target and every posted-to channel in one batched read, one visibility check", async () => {
    const t = setup();
    const d = await device(t, CHAN);
    await recordDevicePost(t.deps, d.id, OTHER, 100);
    const linkable = vi.spyOn(t.linker, "linkable");
    await mirrorReplies(t.deps, d); // CHAN enters at head; OTHER already has a cursor.
    t.ch.agentSays("from room", "Coder", CHAN);
    t.ch.agentSays("from other", "Coder", OTHER);
    t.clock.advance(5_000);
    expect(await mirrorReplies(t.deps, d)).toMatchObject({ queued: 2 });
    expect(linkable).toHaveBeenCalledTimes(2);
    expect(t.ch.reads.at(-1)?.sort()).toEqual([CHAN, OTHER].sort());
  });

  it("keeps a fresh cursor on a new post, so replies already pending still mirror", async () => {
    const t = setup();
    const d = await device(t, CHAN);
    await mirrorReplies(t.deps, d);
    t.ch.agentSays("pending reply", "Coder", CHAN);
    await recordDevicePost(t.deps, d.id, CHAN, 500);
    expect(cursorOf(t, d.id, CHAN)).toBe(100);
    expect(await mirrorReplies(t.deps, d)).toMatchObject({ queued: 1 });
  });

  it("restarts a channel that re-enters scope at its head: no history replay", async () => {
    const t = setup();
    const d = await device(t, CHAN);
    await mirrorReplies(t.deps, d);
    const away = { ...d, current_target_channel_id: OTHER };
    await mirrorReplies(t.deps, away);
    t.ch.agentSays("said while the wearer was elsewhere", "Coder", CHAN);
    t.clock.advance(CURSOR_STALE_MS);
    await mirrorReplies(t.deps, away);
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [CHAN] });
    expect(t.rows).toHaveLength(0);
    t.ch.agentSays("new", "Coder", CHAN);
    expect(await mirrorReplies(t.deps, d)).toMatchObject({ queued: 1 });
  });

  it("skips, and reads nothing from, a channel the owner can no longer see", async () => {
    const room = { name: "Room", members: [USER] };
    const t = setup({ [CHAN]: room });
    const d = await device(t, CHAN);
    await mirrorReplies(t.deps, d);
    room.members = [];
    t.ch.agentSays("after departure", "Coder", CHAN);
    const reads = t.ch.reads.length;
    expect(await mirrorReplies(t.deps, d)).toEqual({ queued: 0, channels: [] });
    expect(t.ch.reads.length).toBe(reads);
    expect(t.rows).toHaveLength(0);
  });

  it("queues a reply once even when two of the owner's devices mirror it", async () => {
    const t = setup();
    const a = await device(t, CHAN);
    const b = await device(t, CHAN);
    await mirrorReplies(t.deps, a);
    await mirrorReplies(t.deps, b);
    t.ch.agentSays("one", "Coder", CHAN);
    await mirrorReplies(t.deps, a);
    await mirrorReplies(t.deps, b);
    expect(t.rows).toHaveLength(1);
  });

  it("mirrors even a one-word reply as a show card (it must not auto-dismiss)", () => {
    expect(replyToGlasses(evenG2, { agentName: "Orchestrator", body: "pong" })).toEqual({
      kind: "show",
      payload: { title: "Orchestrator", lines: ["pong"] },
    });
  });

  it("turns a long reply into a clamped show card", () => {
    const msg = replyToGlasses(evenG2, { agentName: "Coder \u{1F916}", body: "word ".repeat(200) });
    expect(msg?.kind).toBe("show");
    const p = msg!.payload as ShowPayload;
    expect(p.title).toBe("Coder");
    expect(p.lines).toHaveLength(4);
    expect(p.lines[3].endsWith("…")).toBe(true);
    for (const l of p.lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(100);
  });
});

describe("reply text", () => {
  it("drops a reply with nothing drawable", () => {
    expect(replyToGlasses(evenG2, { agentName: "A", body: "\u{1F600}" })).toBeNull();
  });
});
