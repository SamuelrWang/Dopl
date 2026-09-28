import { describe, expect, it } from "vitest";
import { evenG2 } from "../../platforms/even-g2";
import { createFakeChannel } from "../testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "../testing/fake-device-store";
import { createFakeGlassesStore } from "../testing/fake-store";
import { mirrorReplies, replyToGlasses } from "./reply-mirror";
import type { ShowPayload } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const CHAN = "22222222-2222-4222-8222-222222222222";

describe("reply mirror", () => {
  async function linkedDevice(devices: ReturnType<typeof createFakeDeviceStore>["devices"], channel: string | null = CHAN) {
    return devices.insertDevice({ userId: USER, name: "Lens", platform: "even_g2", linkedChannelId: channel, linkedContainerId: null, now: "t" });
  }

  it("starts at the channel head, then mirrors each agent reply exactly once", async () => {
    const { store, rows } = createFakeGlassesStore();
    const { devices, deviceRows } = createFakeDeviceStore();
    const ch = createFakeChannel();
    ch.agentSays("old history, never replayed");
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ [CHAN]: { name: "Room", members: [USER] } }) };
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
      payload: { title: "Coder", lines: ["Build is green. Deploying now."], channel_id: CHAN, agent_session_id: "abcdefgh" },
    });
    expect(Date.parse(rows[0].expires_at) - Date.parse(rows[0].created_at)).toBe(600_000);
  });

  it("is idempotent even if the cursor is rewound, and ignores unlinked devices", async () => {
    const { store, rows } = createFakeGlassesStore();
    const { devices } = createFakeDeviceStore();
    const ch = createFakeChannel();
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ [CHAN]: { name: "Room", members: [USER] } }) };
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
    const deps = { store, devices, gateway: ch.gateway, linker: fakeLinker({ [CHAN]: room }) };
    const device = await linkedDevice(devices);
    const { cursor } = await mirrorReplies(deps, device);
    room.members = [];
    ch.agentSays("after departure");
    expect(await mirrorReplies(deps, { ...device, reply_cursor_seq: cursor })).toEqual({ queued: 0, cursor: null, unlinked: true });
    expect(rows).toHaveLength(0);
    expect(deviceRows[0].linked_channel_id).toBeNull();
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
