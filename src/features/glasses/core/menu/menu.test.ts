import { describe, expect, it, vi } from "vitest";
import { displayOf } from "@/features/display/core/adapt";
import { createHeyEvenHandlers } from "../../platforms/even-g2/hey-even";
import { evenG2 } from "../../platforms/even-g2";
import { sanitizeG2Text } from "../../platforms/even-g2/text";
import { hashCredential } from "../devices/credentials";
import { createFakeChannel } from "../testing/fake-channel";
import { createFakeDeviceStore, fakeLinker } from "../testing/fake-device-store";
import { createFakeGlassesStore, fakeClock } from "../testing/fake-store";
import { createMenuHandlers } from "./handlers";
import { agentStatus, launchName, launchOptions, nextFreeName, readChannel, toLensMessage } from "./service";
import type { LaunchState, MenuChannelHandle, MenuGateway, MenuMessage, MenuSession } from "./types";

type GatewayOverrides = Partial<MenuGateway & MenuChannelHandle>;

const OWNER = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";
const SECRET = "44444444-4444-4444-8444-444444444444";
const TOKEN = "glsdt_test";
const BASE = "http://127.0.0.1:3100/api/glasses/device";
/** Inside the 120s liveness window of `fakeClock()`'s start. */
const FRESH = "2026-09-26T11:59:30.000Z";

const msg = (seq: number, over: Partial<MenuMessage> = {}): MenuMessage => ({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
  seq,
  kind: "message",
  authorKind: "user",
  authorUserId: OWNER,
  authorName: "Sam",
  authorAgentId: null,
  authorAgentName: null,
  recipientAgentIds: [],
  body: `m${seq}`,
  createdAt: `2026-09-27T00:00:${String(seq).padStart(2, "0")}Z`,
  display: null,
  answerTo: null,
  ...over,
});

function fakeGateway(over: GatewayOverrides = {}, sessions: MenuSession[] = defaultSessions()) {
  const launches: LaunchState[] = [];
  return { sessions, gw: buildGateway(over, sessions, launches) };
}

function defaultSessions(): MenuSession[] {
  return [
    { agentId: "abcdefgh", displayName: "Orchestrator", channelId: OPS, state: "working", detail: "tool", model: "claude-opus-5", lastActivity: "t2", updatedAt: FRESH, userId: OWNER, toolLabel: "Bash" },
    { agentId: "zyxwvuts", displayName: null, channelId: OPS, state: "idle", detail: "awaiting_inbound", model: null, lastActivity: "t1", updatedAt: FRESH, userId: OWNER, toolLabel: null },
  ];
}

function buildGateway(over: GatewayOverrides, sessions: MenuSession[], launches: LaunchState[]): MenuGateway {
  const channel: MenuChannelHandle = {
    readMessages: async (q) => {
      const all = [
        msg(1),
        msg(2, { authorKind: "agent", authorUserId: OWNER, authorAgentId: "abcdefgh", authorAgentName: "Orchestrator", body: "**Done.** See ![c](x.png)" }),
        msg(3, { authorUserId: "someone", authorName: "Kim", recipientAgentIds: ["abcdefgh"] }),
        msg(4, { recipientAgentIds: ["abcdefgh"], body: "thanks" }),
        msg(5, { kind: "task_progress", authorKind: "agent" }),
      ].filter((m) => q.before === undefined || m.seq < q.before);
      return { messages: all.slice(-q.limit), hasMore: all.length > q.limit };
    },
    awaitMessages: async (after) => [msg(after + 1, { body: "new" })],
    createLaunch: async () => {
      const l: LaunchState = { directiveId: "55555555-5555-4555-8555-555555555555", status: "launching", agentId: null, agentName: "Claude Opus", refusalReason: null };
      launches.push(l);
      return l;
    },
    getLaunch: async () => ({ ...launches[0], status: "launched", agentId: "newagent", agentName: "Claude Opus" }),
    answerDisplay: async () => ({ answer: { block_id: "b4", choice: "x", index: 0, at: "t", via: "glasses" } }),
  };
  const gw: MenuGateway = {
    listChannels: async () => [
      { id: OPS, name: "Ops \u{1F680}", containerId: "c1", containerName: "Acme", lastActivity: "2026-09-27T01:00Z", unread: true },
    ],
    listSessions: async (ids, limit) => sessions.filter((s) => ids.includes(s.channelId)).slice(0, limit),
    runtimesFor: async () => new Map([["abcdefgh", "claude"]]),
    launchHistory: async () => [{ runtime: "codex", model: "gpt-6" }],
    recentLaunchNames: async () => ["New agent", "new agent 2"],
    openChannel: async () => ({
      readMessages: over.readMessages ?? channel.readMessages,
      awaitMessages: over.awaitMessages ?? channel.awaitMessages,
      createLaunch: over.createLaunch ?? channel.createLaunch,
      getLaunch: over.getLaunch ?? channel.getLaunch,
      answerDisplay: over.answerDisplay ?? channel.answerDisplay,
    }),
    persistedAgentNames: async () => new Map(),
    ...over,
  };
  return gw;
}

function setup(opts: { gateway?: GatewayOverrides; allowLaunch?: boolean } = {}) {
  const msgs = createFakeGlassesStore();
  const dev = createFakeDeviceStore();
  const clock = fakeClock();
  const linker = fakeLinker({ [OPS]: { name: "Ops", members: [OWNER] }, [SECRET]: { name: "Secret", members: [] } });
  const { gw: gateway, sessions } = fakeGateway(opts.gateway);
  const ch = createFakeChannel();
  const base = {
    store: msgs.store,
    devices: dev.devices,
    gateway: ch.gateway,
    linker,
    allowPairStart: async () => true,
    now: clock.now,
    sleep: clock.sleep,
  };
  const menu = createMenuHandlers({ ...base, menu: gateway, allowRead: async () => true, allowLaunch: async () => opts.allowLaunch ?? true });
  const heyEven = createHeyEvenHandlers({
    ...base,
    stt: () => null,
    holdMs: 0,
    allowUtterance: async () => true,
    chargeUtterance: async () => null,
  });
  return { ...dev, clock, linker, gateway, sessions, menu, heyEven, ch };
}

async function device(t: ReturnType<typeof setup>) {
  const d = await t.devices.insertDevice({ userId: OWNER, name: "Lens", platform: "even_g2", now: "t" });
  await t.devices.setTokenHash(d.id, hashCredential(TOKEN));
  return d;
}

const get = (path: string) => new Request(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
const send = (method: string, path: string, body: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("menu service", () => {
  it("maps session state to a lens status", () => {
    expect(agentStatus({ state: "working", detail: "tool" })).toBe("working");
    expect(agentStatus({ state: "working", detail: "permission" })).toBe("waiting");
    expect(agentStatus({ state: "idle", detail: "awaiting_inbound" })).toBe("waiting");
    expect(agentStatus({ state: "idle", detail: null })).toBe("idle");
    expect(agentStatus({ state: "ended", detail: null })).toBe("ended");
  });

  it("renders authors as You / member name / agent name, flattened for G2", () => {
    const agent = toLensMessage(msg(2, { authorKind: "agent", authorAgentId: "abcdefgh", authorAgentName: null, body: "# Hi **there** ![x](y.png)" }), OWNER, evenG2);
    expect(agent).toMatchObject({ author: { kind: "agent", name: "agent-abcdefgh" }, text: "Hi there [image]", attachments_note: "[image]" });
    expect(toLensMessage(msg(1), OWNER, evenG2).author).toEqual({ kind: "member", name: "You" });
    expect(toLensMessage(msg(3, { authorUserId: "x", authorName: "Kim" }), OWNER, evenG2).author).toEqual({ kind: "member", name: "Kim" });
  });

  it("filters a conversation to that agent and the owner's messages addressed to it", async () => {
    const t = setup();
    const deps = { gateway: t.gateway, linker: t.linker, devices: t.devices };
    const d = await device(t);
    const all = await readChannel(deps, d, OPS, {});
    expect(all.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    const convo = await readChannel(deps, d, OPS, { agent: "abcdefgh" });
    expect(convo.messages.map((m) => m.seq)).toEqual([2, 4]);
    expect(convo.before).toBe(1);
  });

  it("offers launch runtimes from history plus Claude, each with a Default model", async () => {
    const t = setup();
    const d = await device(t);
    const { runtimes } = await launchOptions({ gateway: t.gateway, linker: t.linker, devices: t.devices }, d, OPS);
    expect(runtimes.map((r) => r.id)).toEqual(["codex", "claude"]);
    expect(runtimes[0].models).toEqual([{ id: "", label: "Default" }, { id: "gpt-6", label: "gpt-6" }]);
    expect(runtimes[1].models[0]).toEqual({ id: "", label: "Default" });
    expect(runtimes[1].models.some((m) => m.label === "Opus 5.5")).toBe(true);
  });
});

describe("menu routes", () => {
  it("home lists recent agents and channels, sanitized", async () => {
    const t = setup();
    await device(t);
    const body = await (await t.menu.home(get("/home"))).json();
    expect(body.channels).toEqual([{ id: OPS, name: "Ops", container_name: "Acme", last_activity: "2026-09-27T01:00Z", unread: true }]);
    expect(body.recent_agents[0]).toEqual({ session_id: "abcdefgh", agent_name: "Orchestrator", channel: { id: OPS, name: "Ops" }, status: "working", last_activity: "t2" });
    expect(body.recent_agents[1]).toMatchObject({ agent_name: "agent-zyxwvuts", status: "waiting" });
  });

  it("refuses channels the owner cannot see, and bad tokens", async () => {
    const t = setup();
    await device(t);
    for (const r of [t.menu.agents(get(`/channels/${SECRET}/agents`), SECRET), t.menu.messages(get(`/channels/${SECRET}/messages`), SECRET)]) {
      const res = await r;
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found." } });
    }
    const anon = new Request(`${BASE}/home`);
    expect((await t.menu.home(anon)).status).toBe(401);
  });

  it("lists channel agents with runtime and status", async () => {
    const t = setup();
    await device(t);
    const { agents } = await (await t.menu.agents(get(`/channels/${OPS}/agents`), OPS)).json();
    expect(agents[0]).toEqual({ session_id: "abcdefgh", name: "Orchestrator", runtime: "claude", model: "claude-opus-5", status: "working", last_activity: "t2" });
  });

  it("reports live agent activity with every read, and wakes a long-poll when it changes", async () => {
    const t = setup({ gateway: { awaitMessages: async () => [] } });
    await device(t);
    const page = await (await t.menu.messages(get(`/channels/${OPS}/messages?limit=2`), OPS)).json();
    expect(page.activity).toEqual([{ session_id: "abcdefgh", name: "Orchestrator", state: "working", detail: "Bash" }]);
    expect(page.activity_version).toMatch(/^[0-9a-f]{12}$/);

    // Same version held: the poll runs to its deadline with nothing new.
    const start = t.clock.now();
    const idle = await (await t.menu.messages(get(`/channels/${OPS}/messages?after=4&wait=6&activity=${page.activity_version}`), OPS)).json();
    expect(idle.messages).toEqual([]);
    expect(t.clock.now() - start).toBeGreaterThanOrEqual(6000);

    // The agent starts replying mid-hold: the poll returns early with the new set.
    t.clock.onSleep(() => {
      t.sessions[0].detail = "posting";
    });
    const woke = await (await t.menu.messages(get(`/channels/${OPS}/messages?after=4&wait=20&activity=${page.activity_version}`), OPS)).json();
    expect(woke.activity).toEqual([{ session_id: "abcdefgh", name: "Orchestrator", state: "replying" }]);
    expect(woke.activity_version).not.toBe(page.activity_version);
    expect((await t.menu.messages(get(`/channels/${OPS}/messages?after=4&activity=XYZ`), OPS)).status).toBe(400);
  });

  it("pages, long-polls and validates message queries", async () => {
    const t = setup();
    await device(t);
    const page = await (await t.menu.messages(get(`/channels/${OPS}/messages?before=4&limit=2`), OPS)).json();
    expect(page.messages.map((m: { seq: number }) => m.seq)).toEqual([2, 3]);
    expect(page.has_more).toBe(true);
    const polled = await (await t.menu.messages(get(`/channels/${OPS}/messages?after=9&wait=20`), OPS)).json();
    expect(polled).toMatchObject({ messages: [{ seq: 10, text: "new" }], after: 10 });
    expect((await t.menu.messages(get(`/channels/${OPS}/messages?limit=500`), OPS)).status).toBe(400);
    expect((await t.menu.messages(get(`/channels/${OPS}/messages?agent=Bad!`), OPS)).status).toBe(400);
  });

  it("keeps holding a filtered long-poll past rows the filter drops, advancing its cursor", async () => {
    // Another conversation's rows (seq 10, 11) land first; this agent's reply (seq 12) later.
    const rows = [
      msg(10, { authorKind: "agent", authorAgentId: "zyxwvuts", body: "other" }),
      msg(11, { kind: "task_progress", authorKind: "agent", authorAgentId: "abcdefgh" }),
      msg(12, { authorKind: "agent", authorAgentId: "abcdefgh", body: "mine" }),
    ];
    let released = 2;
    let releaseLater = true;
    const awaitMessages = vi.fn(async (after: number) => rows.slice(0, released).filter((m) => m.seq > after));
    const t = setup({ gateway: { awaitMessages } });
    await device(t);
    t.clock.onSleep(() => {
      if (releaseLater && awaitMessages.mock.calls.length >= 2) released = 3;
    });
    const start = t.clock.now();
    const res = await (await t.menu.messages(get(`/channels/${OPS}/messages?after=9&wait=20&agent=abcdefgh`), OPS)).json();
    expect(res.messages.map((m: { seq: number }) => m.seq)).toEqual([12]);
    expect(res.after).toBe(12);
    expect(awaitMessages.mock.calls[0][0]).toBe(9);
    expect(awaitMessages.mock.calls.at(-1)![0]).toBe(11);
    expect(t.clock.now() - start).toBeLessThan(20_000);

    // Only filtered rows until the deadline: an empty answer at the deadline, cursor advanced.
    released = 2;
    releaseLater = false;
    const idle = await (await t.menu.messages(get(`/channels/${OPS}/messages?after=9&wait=4&agent=abcdefgh`), OPS)).json();
    expect(idle).toMatchObject({ messages: [], after: 11 });
  });

  it("holds repeated empty long-poll answers for a minimum second", async () => {
    const t = setup({ gateway: { awaitMessages: async () => [] } });
    await device(t);
    const q = `/channels/${OPS}/messages?after=4&wait=1&activity=0`;
    const took: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = t.clock.now();
      await t.menu.messages(get(q), OPS);
      took.push(t.clock.now() - start);
    }
    // The activity version differs from "0", so each poll answers at once; after the burst, 1s minimum.
    expect(took.slice(0, 5).every((ms) => ms < 1000)).toBe(true);
    expect(took.slice(5).every((ms) => ms >= 1000)).toBe(true);
  });

  it("launches through the gateway, holds until launched, and targets the new agent", async () => {
    const t = setup();
    const d = await device(t);
    const res = await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", model: "claude-opus-5" }));
    expect(await res.json()).toMatchObject({ status: "launched", session_id: "newagent", agent_name: "Claude Opus" });
    const row = t.deviceRows.find((r) => r.id === d.id)!;
    expect([row.current_target_channel_id, row.current_target_agent]).toEqual([OPS, "newagent"]);
  });

  it("names the launch: the wearer's name if given, else the next free New agent N", async () => {
    const createLaunch = vi.fn<MenuChannelHandle["createLaunch"]>(async () => ({
      directiveId: "d",
      status: "launched",
      agentId: "newagent",
      agentName: "Scout",
      refusalReason: null,
    }));
    const t = setup({ gateway: { createLaunch } });
    await device(t);
    await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", name: "  Scout \u{1F50D} " }));
    expect(createLaunch.mock.calls[0][0]).toMatchObject({ agentName: "Scout" });
    await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", model: "claude-opus-5", name: "   " }));
    // Unnamed: the next free "New agent N" (taken here: "New agent", "new agent 2").
    expect(createLaunch.mock.calls[1][0]).toMatchObject({ agentName: "New agent 1" });
    expect(launchName("x".repeat(60), sanitizeG2Text)).toHaveLength(40);
    expect(launchName(null, sanitizeG2Text)).toBeNull();
  });

  it("numbers unnamed agents New agent, New agent 1, 2… skipping names in use", () => {
    expect(nextFreeName([])).toBe("New agent");
    expect(nextFreeName(["Orchestrator", "NEW AGENT"])).toBe("New agent 1");
    expect(nextFreeName(["New agent", "New agent 1", "New agent 3"])).toBe("New agent 2");
  });

  it("surfaces launch refusals and an offline desktop as lens-ready errors", async () => {
    const offline = setup({ gateway: { createLaunch: async () => null } });
    await device(offline);
    const r1 = await offline.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude" }));
    expect([r1.status, (await r1.json()).error.code]).toEqual([409, "DESKTOP_OFFLINE"]);

    const refused = setup({
      gateway: { getLaunch: async () => ({ directiveId: "d", status: "refused", agentId: null, agentName: null, refusalReason: "cap" }) },
    });
    await device(refused);
    const r2 = await refused.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude" }));
    expect(await r2.json()).toEqual({ error: { code: "LAUNCH_CAP", message: "Agent limit reached on your computer." } });

    const limited = setup({ allowLaunch: false });
    await device(limited);
    expect((await limited.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude" }))).status).toBe(429);

    const bad = await offline.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "Claude!" }));
    expect(await bad.json()).toEqual({ error: { code: "BAD_RUNTIME", message: "Unknown runtime." } });
  });

  it("stores the current target, and voice then goes to that agent", async () => {
    const t = setup();
    const d = await device(t);
    expect((await t.menu.target(send("PUT", "/target", { channel_id: SECRET }))).status).toBe(404);
    expect((await t.menu.target(send("PUT", "/target", { channel_id: OPS, agent_session_id: "BAD" }))).status).toBe(400);
    expect(await (await t.menu.target(send("PUT", "/target", { channel_id: OPS, agent_session_id: "abcdefgh" }))).json()).toEqual({ ok: true });
    const row = t.deviceRows.find((r) => r.id === d.id)!;
    expect([row.current_target_channel_id, row.current_target_agent]).toEqual([OPS, "abcdefgh"]);

    const heyKey = "glshe_test";
    await t.devices.setAssistantKeyHash(OWNER, d.id, hashCredential(heyKey));
    const res = await t.heyEven.completions(
      new Request("http://127.0.0.1:3100/api/glasses/hey-even", {
        method: "POST",
        headers: { authorization: `Bearer ${heyKey}`, "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "status?" }] }),
      }),
    );
    expect((await res.json()).choices[0].message.content).toBe("Sent to Orchestrator.");
    expect(t.ch.messages.at(-1)).toMatchObject({ body: "status?", agentId: "abcdefgh" });

    await t.menu.target(send("PUT", "/target", { channel_id: null }));
    expect(row.current_target_channel_id).toBeNull();
  });
});

/** The real sample (channel 9e6a4b44…, seq 2288): a credits display from an agent whose session ended. */
const CREDITS = {
  spec_version: 1,
  screen_id: "d-sample-credits",
  wait_for_input: true,
  blocks: [
    { id: "b1", type: "text", border: false, content: "Credit usage - September", selectable: false },
    { id: "b2", type: "progress", label: "Credits", value: 0.32, border: false, selectable: false },
    { id: "b3", type: "divider", border: false, selectable: false },
    { id: "b4", type: "list", items: ["Top up now", "Remind me tomorrow"], border: false, selectable: true },
    { id: "b5", type: "list", items: ["1,609 of 5,000 used (Pro)", "Resets Oct 1"], border: false, selectable: false },
  ],
};
const ENDED = msg(7, { authorKind: "agent", authorAgentId: "t0eh6cuh", authorAgentName: null, body: "flat", display: displayOf({ display: CREDITS }) });

describe("read mode: ended agents, line breaks, displays", () => {
  it("names an ended agent from its persisted name, in one batched lookup", async () => {
    const lookups: string[][] = [];
    const t = setup({
      gateway: {
        readMessages: async () => ({ messages: [ENDED, msg(8, { authorKind: "agent", authorAgentId: "t0eh6cuh", body: "a\n\n\n\nb" }), msg(9, { authorKind: "agent", authorAgentId: "qqqqqqqq" })], hasMore: false }),
        persistedAgentNames: async (_channels, ids) => {
          lookups.push(ids);
          return new Map([["t0eh6cuh", "Orchestrator"]]);
        },
      },
    });
    await device(t);
    const { messages } = await (await t.menu.messages(get(`/channels/${OPS}/messages`), OPS)).json();
    expect(lookups).toEqual([["t0eh6cuh", "t0eh6cuh", "qqqqqqqq"]]);
    expect(messages.map((m: { author: { name: string } }) => m.author.name)).toEqual(["Orchestrator", "Orchestrator", "agent-qqqqqqqq"]);
    expect(messages[1].text).toBe("a\n\nb");
  });

  it("fills unnamed sessions on home from persisted names", async () => {
    const t = setup({ gateway: { persistedAgentNames: async () => new Map([["zyxwvuts", "Scout"]]) } });
    await device(t);
    const body = await (await t.menu.home(get("/home"))).json();
    expect(body.recent_agents[1].agent_name).toBe("Scout");
  });

  it("compiles a display into the chat area, options apart, text multi-line", () => {
    const m = toLensMessage(ENDED, OWNER, evenG2);
    expect(m.id).toBe(ENDED.id);
    expect(m.text).toBe(
      "Credit usage - September\nCredits ███▒▒▒▒▒▒▒ 32%\n──────────\n─ 1,609 of 5,000 used (Pro)\n─ Resets Oct 1\n▶ Top up now\n▶ Remind me tomorrow",
    );
    const d = m.display!;
    expect(d).toMatchObject({ screen_id: "d-sample-credits", options: { block_id: "b4", items: ["Top up now", "Remind me tomorrow"], recommended: null }, answer: null });
    expect(d.fallback).toBeUndefined();
    // The info list is text lines on the lens (a G2 list would draw 40px rows and a selection border).
    expect(d.containers.map((c) => [c.block_id, c.kind])).toEqual([["b1", "text"], ["b2", "text"], ["b3", "text"], ["b5", "text"]]);
    expect(d.containers[3].content).toBe("─ 1,609 of 5,000 used (Pro)\n─ Resets Oct 1");
    expect(d.pages).toBeUndefined();
    for (const c of d.containers) {
      expect(c).not.toHaveProperty("capture");
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(30);
      expect(c.x + c.w).toBeLessThanOrEqual(576);
      expect(c.y + c.h).toBeLessThanOrEqual(202);
    }
    expect(d.containers[1].content).toMatch(/^Credits █+▒+ 32%$/);
  });

  it("continues a display taller than the chat area on further pages; the answer rides along", () => {
    const tall = displayOf({ display: {
      screen_id: "d-tall",
      answer: { block_id: "o", choice: "Yes", index: 0, at: "t", via: "web" },
      blocks: [...Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, type: "text", content: `line ${i}` })), { id: "o", type: "list", items: ["Yes", "No"] }],
    } });
    const d = toLensMessage(msg(1, { authorKind: "agent", display: tall }), OWNER, evenG2).display!;
    expect(d.fallback).toBeUndefined();
    expect(d.pages!.length).toBe(2);
    expect(d.containers).toEqual(d.pages![0].containers);
    for (const p of d.pages!) for (const c of p.containers) expect(c.y + c.h).toBeLessThanOrEqual(202);
    expect(d.pages!.flatMap((p) => p.containers.map((c) => c.content))).toContain("line 7");
    expect(d.decision).toBeUndefined();
    expect(d.answer).toEqual({ block_id: "o", choice: "Yes", index: 0, at: "t", via: "web" });
  });

  it("falls back to the text rendering (paged) when the blocks cannot be drawn", () => {
    const bad = displayOf({ display: { screen_id: "d-bad", blocks: [{ id: "t", type: "text", content: "word ".repeat(60).trim(), lines: 1 }] } });
    const d = toLensMessage(msg(1, { authorKind: "agent", display: bad }), OWNER, evenG2).display!;
    expect(d.fallback).toBe(true);
    expect(d.containers[0]).toMatchObject({ block_id: "fallback", kind: "text", y: 30 });
    for (const c of [...d.containers, ...(d.pages ?? []).flatMap((p) => p.containers)]) expect(c.y + c.h).toBeLessThanOrEqual(202);
  });

  it("shows a malformed display as a plain message", () => {
    const m = toLensMessage(msg(1, { body: "plain", display: displayOf({ display: { blocks: [{ type: "bogus" }] } }) }), OWNER, evenG2);
    expect(m.display).toBeUndefined();
    expect(m.text).toBe("plain");
  });

  it("shows a legacy decision (escalation only) with its options and recommendation", () => {
    const escalation = {
      issue: "Ship now?",
      context: "",
      options: [{ label: "Ship", consequence: "Live in 10m" }, { label: "Wait", consequence: "Tomorrow" }],
      recommendation: { index: 0, why: "Reversible" },
    };
    const d = toLensMessage(msg(1, { authorKind: "agent", display: displayOf({ escalation }) }), OWNER, evenG2).display!;
    expect(d).toMatchObject({ decision: true, options: { block_id: "decision", items: ["Ship (rec)", "Wait"], recommended: 0 } });
  });

  it("carries answer_to on an answer message", () => {
    const answerTo = { message_id: ENDED.id, index: 1, choice: "Remind me tomorrow" };
    expect(toLensMessage(msg(2, { answerTo }), OWNER, evenG2).answer_to).toEqual(answerTo);
  });

  it("answers a display from the glasses through the channel's answer path", async () => {
    const calls: unknown[] = [];
    const t = setup({
      gateway: {
        answerDisplay: async (messageId, input, source) => {
          calls.push({ messageId, input, source });
          return { answer: { choice: "Top up now", index: 0, at: "t", block_id: "b4", via: "glasses" } };
        },
      },
    });
    const d = await device(t);
    const path = `/channels/${OPS}/messages/${ENDED.id}/display/answer`;
    const res = await t.menu.displayAnswer(send("POST", path, { index: 0, block_id: "b4" }), OPS, ENDED.id);
    expect(await res.json()).toEqual({ ok: true, answer: { block_id: "b4", choice: "Top up now", index: 0, at: "t", via: "glasses" } });
    expect(calls).toEqual([
      { messageId: ENDED.id, input: { index: 0, block_id: "b4" }, source: { kind: "glasses", device_id: d.id, label: "Lens", platform: "even_g2" } },
    ]);
    expect((await t.menu.displayAnswer(send("POST", path, { index: 0 }), OPS, "nope")).status).toBe(404);
    expect((await t.menu.displayAnswer(send("POST", path, { index: -1 }), OPS, ENDED.id)).status).toBe(400);
    expect((await t.menu.displayAnswer(send("POST", path, { index: 0 }), SECRET, ENDED.id)).status).toBe(404);
  });
});
