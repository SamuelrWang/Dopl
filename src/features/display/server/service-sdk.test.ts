/**
 * `showDisplay` over `@dopl/sdk` (W1.2, Plan §7.1): users with the `sdk_delivery` flag get their lens
 * copy from an injected SDK lens. Covers the path choice (faithful or prosumer), the failure classes
 * (unavailable → prosumer path; refusal → `skipped:sdk <code>`), the ask hold and the answer bridge.
 * The SDK itself is faked here; the real client end to end is `device-sdk/server/glasses/seam-round-trip.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/channels/server/service", () => ({ postMessage: vi.fn() }));
vi.mock("@/features/channels/server/service-shared", () => ({ requireMemberChannel: vi.fn() }));
vi.mock("@/features/channels/server/repository-messages", () => ({ findMessageById: vi.fn() }));
vi.mock("@/features/channels/server/repository-workspace", () => ({ fetchProfiles: vi.fn(async () => []) }));
vi.mock("./repository", () => ({ findByDisplayId: vi.fn(), hasAnswerMessage: vi.fn(), replaceDisplay: vi.fn(), channelWorkspaceOf: vi.fn() }));
vi.mock("./answer", () => ({ answerDecisionFromLens: vi.fn() }));
vi.mock("@/features/workspaces/server/service", () => ({ resolveActiveWorkspace: vi.fn() }));

import { postMessage } from "@/features/channels/server/service";
import { requireMemberChannel } from "@/features/channels/server/service-shared";
import { findMessageById } from "@/features/channels/server/repository-messages";
import type { ChannelContext } from "@/features/channels/server/service-shared";
import type { GlassesDeps } from "@/features/glasses/core/messages/service";
import { createFakeGlassesStore, fakeClock } from "@/features/glasses/core/testing/fake-store";
import { answerDecisionFromLens } from "./answer";
import { findByDisplayId, hasAnswerMessage } from "./repository";
import { SdkLensError, type SdkAskOutcome, type SdkLens, type SdkUserLens } from "./sdk-lens";
import { showDisplay, type ShowInput } from "./service";

const USER = "11111111-1111-4111-8111-111111111111";
const CHAN = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: USER, workspaceId: "ws", source: "agent", sessionId: `${CHAN}:main:agent-1` } as unknown as ChannelContext;
const CHOICE = [{ type: "heading", text: "Ship?" }, { type: "choice", options: [{ label: "Ship", recommended: true }, { label: "Wait" }] }];
const STATUS = [{ type: "heading", text: "Deploy" }, { type: "progress", value: 0.6, label: "Build" }];

type AskArgs = Parameters<SdkUserLens["ask"]>[0];

function fakeSdk(o: { off?: boolean; forUserErr?: unknown; stateErr?: unknown; screenErr?: unknown; online?: boolean; deviceIds?: string[] } = {}) {
  const screens: unknown[] = [];
  const asks: AskArgs[] = [];
  let settle: ((x: SdkAskOutcome) => void) | null = null;
  const user: SdkUserLens = {
    state: async () => {
      if (o.stateErr) throw o.stateErr;
      return { paired: true, online: o.online ?? true };
    },
    screen: async (a) => {
      screens.push(a);
      if (o.screenErr) throw o.screenErr;
      return { delivery_id: "dl1", routed_to: { device_id: "g2", kind: "glasses", reason: "x" }, status: "queued" } as never;
    },
    ask: (a) => {
      asks.push(a);
      return new Promise<SdkAskOutcome>((res) => {
        settle = res;
        a.signal?.addEventListener("abort", () => res({ status: "aborted", ms: 0 }));
      });
    },
  };
  const lens: SdkLens = {
    forUser: async () => {
      if (o.forUserErr) throw o.forUserErr;
      return o.off ? null : { lens: user, deviceIds: o.deviceIds ?? ["dev"] };
    },
  };
  return { lens, screens, asks, settle: (x: SdkAskOutcome) => settle?.(x) };
}

function setup(sdk: SdkLens, online = true) {
  const fake = createFakeGlassesStore();
  const clock = fakeClock();
  const devices = {
    listDevices: async () => [{ id: "dev", name: "G2", last_seen: new Date(online ? clock.now() : clock.now() - 3_600_000).toISOString() }],
  } as unknown as GlassesDeps["devices"];
  return { ...fake, clock, deps: { store: fake.store, devices, now: clock.now, sleep: clock.sleep, sdk } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
let logs: string[];

beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  vi.spyOn(console, "info").mockImplementation((m: string) => void logs.push(m));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireMemberChannel).mockResolvedValue({ channel: { id: CHAN, name: "Lab" } } as never);
  vi.mocked(postMessage).mockImplementation(async (_c, _ch, input) => ({ id: "m1", metadata: {}, body: input.body }) as never);
  vi.mocked(findByDisplayId).mockResolvedValue(null);
  vi.mocked(hasAnswerMessage).mockResolvedValue(false);
  vi.mocked(findMessageById).mockResolvedValue({ metadata: {} } as never);
});

const shownLog = () => JSON.parse(logs.find((l) => l.includes('"display_shown"'))!.slice("[display] ".length));

describe("path choice", () => {
  it("flag off: the prosumer lens path, unchanged", async () => {
    const t = setup(fakeSdk({ off: true }).lens);
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, t.deps);
    expect(r).toMatchObject({ glasses: "shown", glasses_message_id: t.rows[0].id });
    expect(shownLog()).toMatchObject({ path: "prosumer" });
  });

  it("flag on: a status screen goes over the SDK as stack blocks; no prosumer row, no lens link", async () => {
    const s = fakeSdk();
    const t = setup(s.lens);
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, t.deps);
    expect(r).toMatchObject({ glasses: "shown", message_id: "m1" });
    expect(r).not.toHaveProperty("glasses_message_id");
    expect(t.rows).toHaveLength(0);
    expect(s.screens).toEqual([{ blocks: [expect.objectContaining({ type: "heading", text: "Deploy" }), expect.objectContaining({ type: "progress" })], idempotencyKey: expect.stringMatching(/^display-/) }]);
    expect((s.screens[0] as { idempotencyKey: string }).idempotencyKey.length).toBeLessThanOrEqual(255);
    expect(vi.mocked(postMessage).mock.calls[0][3]?.display?.glasses_message_id).toBeUndefined();
    expect(shownLog()).toMatchObject({ path: "sdk", targets: ["channel", "glasses"] });
  });

  it("🔒 per device: a glasses link paired after the migration keeps the prosumer lens copy (every device reads it)", async () => {
    const s = fakeSdk({ deviceIds: ["dev"] });
    const t = setup(s.lens);
    const both = { ...t.deps, devices: { listDevices: async () => [{ id: "dev", last_seen: null }, { id: "new-pair", last_seen: new Date(t.clock.now()).toISOString() }] } as unknown as GlassesDeps["devices"] };
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, both);
    expect(r.glasses_message_id).toBe(t.rows[0].id);
    expect(s.screens).toHaveLength(0);
    expect(shownLog()).toMatchObject({ path: "prosumer_fallback", fallback_reason: "unmigrated device" });

    logs = [];
    const migratedOnly = setup(fakeSdk({ deviceIds: ["dev", "old-revoked"] }).lens);
    await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, migratedOnly.deps);
    expect(shownLog()).toMatchObject({ path: "sdk" });
  });

  it("what the contract cannot carry faithfully keeps the prosumer lens copy, logged with its reason", async () => {
    const s = fakeSdk();
    const t = setup(s.lens);
    const busy = [{ type: "fields", rows: [{ label: "Env", value: "prod" }] }, ...CHOICE];
    await showDisplay(ctx, { blocks: busy }, undefined, t.deps);
    expect(t.rows).toHaveLength(1);
    expect(s.asks).toHaveLength(0);
    expect(shownLog()).toMatchObject({ path: "prosumer_fallback", fallback_reason: "choice beside other blocks" });

    logs = [];
    await showDisplay(ctx, { blocks: [{ type: "text", content: "x", x: 0, y: 0 }], layout: "absolute", target: "glasses", shortcut: "render" }, undefined, t.deps);
    expect(shownLog()).toMatchObject({ path: "prosumer_fallback", fallback_reason: "absolute layout" });
    expect(s.screens).toHaveLength(0);
  });
});

describe("failure classes", () => {
  it("SDK unavailable (flag lookup, key, network, 5xx): the prosumer path, which a migrated G2 still reads", async () => {
    const t = setup(fakeSdk({ forUserErr: new SdkLensError("no_key", true) }).lens);
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, t.deps);
    expect(r.glasses_message_id).toBe(t.rows[0].id);
    expect(shownLog()).toMatchObject({ path: "prosumer_fallback", fallback_reason: "no_key" });

    const n = setup(fakeSdk({ screenErr: new SdkLensError("network_error", true) }).lens);
    expect((await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, n.deps)).glasses_message_id).toBe(n.rows[0].id);

    const st = setup(fakeSdk({ stateErr: new SdkLensError("http_503", true) }).lens);
    expect((await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, st.deps)).glasses_message_id).toBe(st.rows[0].id);
  });

  it("🔒 an SDK refusal is reported, never retried on the prosumer path (no second lens copy)", async () => {
    const t = setup(fakeSdk({ screenErr: new SdkLensError("invalid_request", false) }).lens);
    const r = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, t.deps);
    expect(r).toMatchObject({ glasses: "skipped:sdk invalid_request", message_id: "m1" });
    expect(t.rows).toHaveLength(0);

    const timedOut = setup(fakeSdk({ stateErr: new SdkLensError("timeout", false) }).lens);
    const r2 = await showDisplay(ctx, { blocks: STATUS, target: "glasses" }, undefined, timedOut.deps);
    expect(r2).toMatchObject({ glasses: "skipped:sdk timeout", message_id: "m1" });
    expect(timedOut.rows).toHaveLength(0);
  });

  it("offline over the SDK: auto skips the lens like the prosumer path", async () => {
    const s = fakeSdk({ online: false });
    const t = setup(s.lens);
    expect((await showDisplay(ctx, { blocks: CHOICE }, undefined, t.deps)).glasses).toBe("skipped:no online glasses");
    expect(s.asks).toHaveLength(0);
  });
});

describe("asks and the answer bridge", () => {
  it("a decision is an SDK ask card; without wait the lens answer still posts to the channel decision", async () => {
    vi.mocked(answerDecisionFromLens).mockResolvedValue({ result: "ok" });
    const s = fakeSdk();
    const t = setup(s.lens);
    const r = await showDisplay(ctx, { blocks: CHOICE }, undefined, t.deps);
    expect(r).toMatchObject({ glasses: "shown", decision: true, message_id: "m1" });
    expect(s.asks[0]).toMatchObject({ question: "Ship?", options: ["Ship", "Wait"], timeoutMs: 120_000 });
    s.settle({ status: "answered", index: 1, label: "Wait", deviceId: "g2", ms: 900 });
    await flush();
    expect(answerDecisionFromLens).toHaveBeenCalledWith(USER, "m1", 1, expect.objectContaining({ kind: "glasses", device_id: "g2", platform: "even_g2" }));
  });

  it("wait: the lens answer returns through the bridge's stamp", async () => {
    const stamp = { block_id: "b2", index: 0, choice: "Ship", at: "t", via: "glasses", by: USER, message_id: "a1" };
    vi.mocked(answerDecisionFromLens).mockResolvedValue({ result: "ok", answer: stamp });
    const s = fakeSdk();
    const t = setup(s.lens);
    t.clock.onSleep(() => s.settle({ status: "answered", index: 0, label: "Ship", deviceId: "g2", ms: 3 }));
    expect(await showDisplay(ctx, { blocks: CHOICE, wait: true }, undefined, t.deps)).toMatchObject({ status: "answered", answer: stamp });
  });

  it("wait: an answer in the channel first wins and stops the SDK ask", async () => {
    const s = fakeSdk();
    const t = setup(s.lens);
    const answer = { block_id: "b2", index: 1, choice: "Wait", at: "t", via: "web" };
    vi.mocked(findMessageById).mockResolvedValue({ metadata: { display: { spec_version: 2, display_id: "d", blocks: CHOICE, answer } } } as never);
    expect(await showDisplay(ctx, { blocks: CHOICE, wait: true }, undefined, t.deps)).toMatchObject({ status: "answered", answer });
    expect(s.asks[0].signal?.aborted).toBe(true);
    expect(answerDecisionFromLens).not.toHaveBeenCalled();
  });

  it("glasses_ask: same validation as the prosumer card; a dismiss and a refusal come back as such", async () => {
    const ask = (question: string, options = ["Yes", "No"]): ShowInput => ({
      target: "glasses",
      shortcut: "ask",
      origin: "glasses_ask",
      blocks: [{ id: "question", type: "text", content: question }, { id: "options", type: "choice", options: options.map((label) => ({ label })) }],
      wait: true,
    });
    const s = fakeSdk();
    const t = setup(s.lens);
    await expect(showDisplay(ctx, ask("x".repeat(200)), undefined, t.deps)).rejects.toThrow(/question is 200 bytes; max 120/);

    const lone = { ...ctx, sessionId: undefined } as unknown as ChannelContext;
    t.clock.onSleep(() => s.settle({ status: "dismissed", deviceId: "g2", ms: 1 }));
    expect(await showDisplay(lone, ask("Join?"), undefined, t.deps)).toMatchObject({ status: "dismissed", answer: null });

    const r = setup(s.lens);
    r.clock.onSleep(() => s.settle({ status: "refused", code: "device_offline", ms: 1 }));
    expect(await showDisplay(lone, ask("Join?"), undefined, r.deps)).toMatchObject({ status: "timeout", glasses: "skipped:sdk device_offline" });
  });

  it("past the hold an SDK ask is a timeout, never `pending` (no prosumer row to read later)", async () => {
    const s = fakeSdk();
    const t = setup(s.lens);
    const lone = { ...ctx, sessionId: undefined } as unknown as ChannelContext;
    const input: ShowInput = {
      target: "glasses",
      shortcut: "ask",
      blocks: [{ type: "text", content: "Join?" }, { type: "choice", options: [{ label: "Yes" }, { label: "No" }] }],
      wait: true,
      timeout_sec: 3_600,
    };
    expect(await showDisplay(lone, input, undefined, t.deps)).toMatchObject({ status: "timeout" });
    expect(s.asks[0].signal?.aborted).toBe(true);
  });
});
