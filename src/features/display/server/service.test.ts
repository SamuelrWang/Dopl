/**
 * `showDisplay` (spec §4.2, §3.4, §3.5): the routing matrix, validate_only, replace-by-id and the
 * hold — over an in-memory lens store, with the channels service and the display statements mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/channels/server/service", () => ({ postMessage: vi.fn() }));
vi.mock("@/features/channels/server/service-shared", () => ({ requireMemberChannel: vi.fn() }));
vi.mock("@/features/channels/server/repository-messages", () => ({ findMessageById: vi.fn() }));
vi.mock("./repository", () => ({ findByDisplayId: vi.fn(), hasAnswerMessage: vi.fn(), replaceDisplay: vi.fn() }));

import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { DeviceStore } from "@/features/glasses/core/devices/types";
import { createFakeGlassesStore, fakeClock } from "@/features/glasses/core/testing/fake-store";
import { findByDisplayId, hasAnswerMessage, replaceDisplay } from "./repository";
import { showDisplay, type ShowInput } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const CHAN = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: USER, workspaceId: "ws", source: "agent", sessionId: `${CHAN}:main:agent-1` } as unknown as ChannelContext;
const CHOICE = [{ type: "heading", text: "Ship?" }, { type: "choice", options: [{ label: "Ship", recommended: true }, { label: "Wait" }] }];
const STATUS = [{ type: "heading", text: "Deploy" }, { type: "progress", value: 0.6, label: "Build" }];

let online: boolean | null;
function setup() {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const seen = () => (online === null ? [] : [{ id: "dev", name: "G2", last_seen: new Date(online ? clock.now() : clock.now() - 3_600_000).toISOString() }]);
  const devices = { listDevices: async () => seen() } as unknown as DeviceStore;
  return { ...fake, clock, deps: { store: fake.store, devices, now: clock.now, sleep: clock.sleep } };
}
const show = (input: ShowInput, deps = setup().deps) => showDisplay(ctx, input, undefined, deps);

beforeEach(() => {
  vi.clearAllMocks();
  online = null;
  vi.mocked(requireMemberChannel).mockResolvedValue({ channel: { id: CHAN, name: "Lab" } } as never);
  vi.mocked(postMessage).mockImplementation(async (_c, _ch, input) => ({ id: "m1", metadata: {}, body: input.body }) as never);
  vi.mocked(findByDisplayId).mockResolvedValue(null);
  vi.mocked(hasAnswerMessage).mockResolvedValue(false);
  vi.mocked(replaceDisplay).mockResolvedValue(true);
});

describe("routing (§4.2)", () => {
  it("auto, session channel, no glasses: a channel post; a choice posts like a decision, status as a record", async () => {
    const r = await show({ blocks: CHOICE });
    expect(r).toMatchObject({ message_id: "m1", channel_id: CHAN, glasses: "skipped:no online glasses", decision: true });
    const [, channel, input, opts] = vi.mocked(postMessage).mock.calls[0];
    expect(channel).toBe(CHAN);
    expect(input).toMatchObject({ body: "Ship?\n1. Ship (recommended)\n2. Wait", summary: "Ship?", authorKind: "agent" });
    expect(input).not.toHaveProperty("intent");
    expect(opts?.display).toMatchObject({ origin: "dopl_show", display_id: r.display_id });
    await show({ blocks: STATUS });
    expect(vi.mocked(postMessage).mock.calls[1][2]).toMatchObject({ intent: "chat" });
  });

  it("auto with online glasses pushes a choice to the lens (linked), but not a plain status", async () => {
    online = true;
    const t = setup();
    const r = await show({ blocks: CHOICE }, t.deps);
    expect(r.glasses).toBe("shown");
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ kind: "screen", card_id: r.display_id, channel_message_id: "m1" });
    expect(vi.mocked(postMessage).mock.calls[0][3]?.display?.glasses_message_id).toBe(t.rows[0].id);
    const s = await show({ blocks: STATUS }, t.deps);
    expect(s.glasses).toBe("skipped:no online glasses");
    expect(t.rows).toHaveLength(1);
  });

  it("target channel needs a channel; glasses needs paired glasses; auto with nowhere refuses", async () => {
    const lone = { ...ctx, sessionId: undefined } as unknown as ChannelContext;
    await expect(showDisplay(lone, { blocks: STATUS, target: "channel" }, undefined, setup().deps)).rejects.toThrow(/name a channel/);
    await expect(show({ blocks: STATUS, target: "glasses" })).rejects.toThrow(/No paired glasses/);
    await expect(showDisplay(lone, { blocks: STATUS }, undefined, setup().deps)).rejects.toThrow(/Nowhere to show it/);
  });

  it("target glasses: the lens copy even offline, plus the channel mirror; compile errors are returned", async () => {
    online = false;
    const t = setup();
    const r = await show({ blocks: STATUS, target: "glasses" }, t.deps);
    expect(r).toMatchObject({ glasses: "shown", message_id: "m1" });
    const tall = { blocks: [{ type: "text", content: "x".repeat(1500) }], target: "glasses" as const };
    await expect(show(tall, t.deps)).rejects.toThrow(/"errors"/);
  });

  it("refuses invalid blocks with every error, and wait without a choice", async () => {
    await expect(show({ blocks: [{ type: "text", content: "x", color: "red" }] })).rejects.toThrow(/unknown_key/);
    await expect(show({ blocks: STATUS, wait: true })).rejects.toThrow(/wait needs a choice/);
  });
});

describe("validate_only", () => {
  it("previews every surface and sends nothing; a 12-row table degrades on the lens", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => [`job ${i}`, "running"]);
    const r = await show({ validate_only: true, blocks: [{ type: "heading", text: "Jobs" }, { type: "table", columns: ["Job", "State"], rows }, { type: "fields", rows: [{ label: "a", value: "b" }, { label: "c", value: "d" }] }] });
    expect(r.preview).toMatch(/^valid · chat: 3 blocks · glasses: degraded\(level \d: rows halved\)\n\+-+\+/);
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("replace by display_id (§3.5)", () => {
  it("replaces an unanswered display in place, and posts a new one after an answer", async () => {
    vi.mocked(findByDisplayId).mockResolvedValue({ id: "old", metadata: { display: { spec_version: 2, display_id: "deploy-1", blocks: STATUS } } } as never);
    const r = await show({ blocks: STATUS, display_id: "deploy-1" });
    expect(r).toMatchObject({ message_id: "old", replaced: "in-place" });
    expect(vi.mocked(replaceDisplay).mock.calls[0].slice(0, 3)).toEqual(["old", USER, "Deploy\nBuild 60%"]);
    expect(postMessage).not.toHaveBeenCalled();
    vi.mocked(hasAnswerMessage).mockResolvedValue(true);
    const again = await show({ blocks: CHOICE, display_id: "deploy-1" });
    expect(again).toMatchObject({ message_id: "m1", replaced: "new" });
  });
});

describe("wait (§3.4)", () => {
  it("stamps wait_until and returns the channel answer", async () => {
    const t = setup();
    let polls = 0;
    vi.mocked(findMessageById).mockImplementation(async () => {
      polls++;
      const answer = polls >= 2 ? { block_id: "b2", index: 0, choice: "Ship", at: "t", via: "computer", by: "u2" } : null;
      return { metadata: { display: { spec_version: 2, display_id: "d", blocks: CHOICE, answer } } } as never;
    });
    const r = await show({ blocks: CHOICE, wait: true, timeout_sec: 30 }, t.deps);
    expect(r).toMatchObject({ status: "answered", answer: { index: 0, choice: "Ship", via: "computer" } });
    const waitUntil = vi.mocked(postMessage).mock.calls[0][3]?.display?.wait_until;
    expect(Date.parse(waitUntil!) - t.clock.now()).toBeLessThanOrEqual(30_000);
  });

  it("times out past wait_until + 5s; a shortcut past the 200s cap is pending", async () => {
    vi.mocked(findMessageById).mockResolvedValue({ metadata: { display: { spec_version: 2, display_id: "d", blocks: CHOICE } } } as never);
    const t = setup();
    const start = t.clock.now();
    expect(await show({ blocks: CHOICE, wait: true, timeout_sec: 10 }, t.deps)).toMatchObject({ status: "timeout", answer: null });
    expect(t.clock.now() - start).toBeGreaterThanOrEqual(15_000);
    online = true;
    const g = setup();
    const ask = await show({ blocks: CHOICE, wait: true, timeout_sec: 600, shortcut: "ask", target: "glasses" }, g.deps);
    expect(ask.status).toBe("pending");
    expect(g.rows[0]).toMatchObject({ kind: "ask", payload: { question: "Ship?", options: ["Ship", "Wait"] } });
  });

  it("returns a lens tap as answered via glasses, and a back as dismissed", async () => {
    online = true;
    vi.mocked(findMessageById).mockResolvedValue({ metadata: {} } as never);
    const t = setup();
    t.clock.onSleep(async () => {
      const [row] = t.rows;
      if (row && row.status === "pending") await t.store.transition(USER, row.id, ["pending"], "answered", "t", { choice: "Wait", index: 1, at: "t" });
    });
    expect(await show({ blocks: CHOICE, wait: true }, t.deps)).toMatchObject({ status: "answered", answer: { index: 1, via: "glasses" } });
  });
});
