import { describe, expect, it, vi } from "vitest";
import { createFakeDeviceStore, fakeLinker } from "./fake-device-store";
import { createFakeGlassesStore, fakeClock } from "./fake-store";
import { createMenuHandlers } from "./menu-handlers";
import { agentStatus, launchName, launchOptions, nextFreeName, readChannel, toG2Message } from "./menu-service";
import type { LaunchState, MenuGateway, MenuMessage, MenuSession } from "./menu-types";
import { hashCredential } from "./credentials";
import { createVoiceHandlers } from "./voice-handlers";
import { createFakeChannel } from "./voice-test-kit";

const OWNER = "22222222-2222-4222-8222-222222222222";
const OPS = "33333333-3333-4333-8333-333333333333";
const SECRET = "44444444-4444-4444-8444-444444444444";
const TOKEN = "glsdt_test";
const BASE = "http://127.0.0.1:3100/api/glasses/device";
/** Inside the 120s liveness window of `fakeClock()`'s start. */
const FRESH = "2026-09-26T11:59:30.000Z";

const msg = (seq: number, over: Partial<MenuMessage> = {}): MenuMessage => ({
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
  ...over,
});

function fakeGateway(over: Partial<MenuGateway> = {}, sessions: MenuSession[] = defaultSessions()) {
  const launches: LaunchState[] = [];
  return { sessions, gw: buildGateway(over, sessions, launches) };
}

function defaultSessions(): MenuSession[] {
  return [
    { agentId: "abcdefgh", displayName: "Orchestrator", channelId: OPS, state: "working", detail: "tool", model: "claude-opus-5", lastActivity: "t2", updatedAt: FRESH, userId: OWNER, toolLabel: "Bash" },
    { agentId: "zyxwvuts", displayName: null, channelId: OPS, state: "idle", detail: "awaiting_inbound", model: null, lastActivity: "t1", updatedAt: FRESH, userId: OWNER, toolLabel: null },
  ];
}

function buildGateway(over: Partial<MenuGateway>, sessions: MenuSession[], launches: LaunchState[]): MenuGateway {
  const gw: MenuGateway = {
    listChannels: async () => [
      { id: OPS, name: "Ops \u{1F680}", containerId: "c1", containerName: "Acme", lastActivity: "2026-09-27T01:00Z", unread: true },
    ],
    listSessions: async (ids, limit) => sessions.filter((s) => ids.includes(s.channelId)).slice(0, limit),
    runtimesFor: async () => new Map([["abcdefgh", "claude"]]),
    readMessages: async (_u, _c, q) => {
      const all = [
        msg(1),
        msg(2, { authorKind: "agent", authorUserId: OWNER, authorAgentId: "abcdefgh", authorAgentName: "Orchestrator", body: "**Done.** See ![c](x.png)" }),
        msg(3, { authorUserId: "someone", authorName: "Kim", recipientAgentIds: ["abcdefgh"] }),
        msg(4, { recipientAgentIds: ["abcdefgh"], body: "thanks" }),
        msg(5, { kind: "task_progress", authorKind: "agent" }),
      ].filter((m) => q.before === undefined || m.seq < q.before);
      return { messages: all.slice(-q.limit), hasMore: all.length > q.limit };
    },
    awaitMessages: async (_u, _c, after) => [msg(after + 1, { body: "new" })],
    launchHistory: async () => [{ runtime: "codex", model: "gpt-6" }],
    recentLaunchNames: async () => ["New agent", "new agent 2"],
    createLaunch: async () => {
      const l: LaunchState = { directiveId: "55555555-5555-4555-8555-555555555555", status: "launching", agentId: null, agentName: "Claude Opus", refusalReason: null };
      launches.push(l);
      return l;
    },
    getLaunch: async () => ({ ...launches[0], status: "launched", agentId: "newagent", agentName: "Claude Opus" }),
    ...over,
  };
  return gw;
}

function setup(opts: { gateway?: Partial<MenuGateway>; allowLaunch?: boolean } = {}) {
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
  const voice = createVoiceHandlers({
    ...base,
    stt: () => null,
    holdMs: 0,
    allowUtterance: async () => true,
    chargeUtterance: async () => null,
  });
  return { ...dev, clock, linker, gateway, sessions, menu, voice, ch };
}

async function device(t: ReturnType<typeof setup>) {
  const d = await t.devices.insertDevice({ userId: OWNER, name: "Lens", platform: "even_g2", linkedChannelId: null, linkedContainerId: null, now: "t" });
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
    const agent = toG2Message(msg(2, { authorKind: "agent", authorAgentId: "abcdefgh", authorAgentName: null, body: "# Hi **there** ![x](y.png)" }), OWNER);
    expect(agent).toMatchObject({ author: { kind: "agent", name: "agent-abcdefgh" }, text: "Hi there [image]", attachments_note: "[image]" });
    expect(toG2Message(msg(1), OWNER).author).toEqual({ kind: "member", name: "You" });
    expect(toG2Message(msg(3, { authorUserId: "x", authorName: "Kim" }), OWNER).author).toEqual({ kind: "member", name: "Kim" });
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
    expect(runtimes[1].models.some((m) => m.label === "Opus 5")).toBe(true);
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

  it("launches through the gateway, holds until launched, and targets the new agent", async () => {
    const t = setup();
    const d = await device(t);
    const res = await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", model: "claude-opus-5" }));
    expect(await res.json()).toMatchObject({ status: "launched", session_id: "newagent", agent_name: "Claude Opus" });
    const row = t.deviceRows.find((r) => r.id === d.id)!;
    expect([row.current_target_channel_id, row.current_target_agent]).toEqual([OPS, "newagent"]);
  });

  it("names the launch: the wearer's name if given, else the next free New agent N", async () => {
    const createLaunch = vi.fn<MenuGateway["createLaunch"]>(async () => ({
      directiveId: "d",
      status: "launched",
      agentId: "newagent",
      agentName: "Scout",
      refusalReason: null,
    }));
    const t = setup({ gateway: { createLaunch } });
    await device(t);
    await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", name: "  Scout \u{1F50D} " }));
    expect(createLaunch.mock.calls[0][2]).toMatchObject({ agentName: "Scout" });
    await t.menu.launch(send("POST", "/launch", { channel_id: OPS, runtime: "claude", model: "claude-opus-5", name: "   " }));
    // Unnamed: the next free "New agent N" (taken here: "New agent", "new agent 2").
    expect(createLaunch.mock.calls[1][2]).toMatchObject({ agentName: "New agent 1" });
    expect(launchName("x".repeat(60))).toHaveLength(40);
    expect(launchName(null)).toBeNull();
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
    await t.devices.setHeyEvenKeyHash(OWNER, d.id, hashCredential(heyKey));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await t.voice.heyEven(
      new Request("http://127.0.0.1:3100/api/glasses/hey-even", {
        method: "POST",
        headers: { authorization: `Bearer ${heyKey}`, "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "status?" }] }),
      }),
    );
    log.mockRestore();
    expect((await res.json()).choices[0].message.content).toBe("Sent to Orchestrator.");
    expect(t.ch.messages.at(-1)).toMatchObject({ body: "status?", agentId: "abcdefgh" });

    await t.menu.target(send("PUT", "/target", { channel_id: null }));
    expect(row.current_target_channel_id).toBeNull();
  });
});
