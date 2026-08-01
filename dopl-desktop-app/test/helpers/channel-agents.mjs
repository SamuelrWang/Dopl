// Shared source-extraction harness for the channel-agents suites (no tests of its own).
//
// FIVE real modules, wired to each other exactly as they are in the app, with fakes only at
// the two edges that need a host (HTTP and the session engine):
//   channel-roster.js      CHANNEL-ROSTER-PURE — the cached rows, the GET, the PATCH, and the
//                          author label a fed message is titled with.
//   channel-deliver.js     CHANNEL-DELIVER-PURE — the lazy wake, the SELF-ECHO filter and the
//                          hand-off to the inbound gate. Injected REAL, so the routing suites
//                          drive the shipped delivery rule rather than a restatement of it.
//   channel-engagement.js  CHANNEL-ENGAGEMENT-PURE — the TTL, the addressee list, the local
//                          sliding window. Injected REAL, so the routing tests drive the
//                          shipped engagement policy rather than a restatement of it.
//   channel-threads.js     CHANNEL-THREADS-PURE — the breakout room's participant set, its
//                          cache and the "which of these are MINE" predicate.
//   channel-agents.js      CHANNEL-AGENTS-PURE — reconcile, summon, the routing rule.
//
// Each harness() call evaluates all four afresh, so the module state inside them (the roster
// cache, the local act map, the single-flight map) cannot leak between tests.
//
// THREE suites share this: channel-agents.test.mjs keeps the roster policy, the summon lane
// and the addressed route; channel-engagement.test.mjs owns the engagement window and the
// untagged lane; channel-threads.test.mjs owns the breakout room. One harness keeps the
// fixtures identical between them (and keeps each file under the §2 500-line cap).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "..", "main");

// A missing / inverted sentinel would slice "" and pass every negative assertion VACUOUSLY,
// so it throws here rather than handing a silent empty block to either suite.
function slice(file, name) {
  const src = readFileSync(join(MAIN, file), "utf8");
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  if (from === -1 || to === -1 || to <= from) throw new Error(`${name} sentinels missing or out of order`);
  return { src, block: src.slice(from, to) };
}

export const AGENTS = slice("channel-agents.js", "CHANNEL-AGENTS-PURE");
export const DELIVER = slice("channel-deliver.js", "CHANNEL-DELIVER-PURE");
export const ROSTER = slice("channel-roster.js", "CHANNEL-ROSTER-PURE");
export const ENGAGEMENT = slice("channel-engagement.js", "CHANNEL-ENGAGEMENT-PURE");
export const THREADS = slice("channel-threads.js", "CHANNEL-THREADS-PURE");
export const BANNED = ["require(", "electron", "fs.", "child_process"];

export const ME = "me-uuid";
export const PEER = "peer-uuid";
export const CH = "chan-1";
export const MINE = "agent-mine";
export const MINE2 = "agent-mine-2";
export const THEIRS = "agent-theirs";
export const THREAD = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"; // a FIRST-CLASS (UUID) thread id

export const agent = (over = {}) => ({
  id: MINE, channelId: CH, ownerUserId: ME, name: "quartz", status: "summoned", ...over,
});

export const entry = () => ({ channel: { id: CH, name: "Ops" }, workspaceId: "ws-1" });

export const msg = (over = {}) => ({
  kind: "message", authorKind: "user", authorUserId: PEER, seq: 9, body: "please look", ...over,
});

// The REAL ENGAGEMENT_TTL_MS, read off the shipped source rather than restated here — a suite
// that hard-coded 60 minutes would keep passing if the constant moved.
export const TTL_MS = Number(
  new Function(`${ENGAGEMENT.block}\n return ENGAGEMENT_TTL_MS;`)()
);

/** An `engagedAt` this many ms in the past, as the DTO's ISO string. */
export const engagedAgo = (ms) => new Date(Date.now() - ms).toISOString();

export function harness(cfg = {}) {
  const calls = { fetch: [], patch: [], summon: [], wake: [], feed: [], diag: [], persisted: [] };
  const rosterRows = cfg.roster === undefined ? [agent()] : cfg.roster;
  const durable = { ...(cfg.durable || {}) }; // the electron-store map, seeded per test

  const io = {
    apiFetch: async (pathname, opts) => {
      calls.fetch.push({ pathname, method: (opts && opts.method) || "GET", body: opts && opts.body });
      if (opts && opts.method === "PATCH") {
        calls.patch.push({ pathname, body: opts.body });
        return { ok: cfg.patchOk !== false, status: cfg.patchOk === false ? 500 : 200 };
      }
      // The breakout room's participant set: GET /api/channels/<id>/tasks/<threadId>.
      // `cfg.participants` undefined means the test never opened a thread, so the read fails
      // the way a 404 does — which is also the assertion that an unknown set routes nobody.
      //
      // TWO DIFFERENT "STATUS" WORDS, deliberately kept apart. `cfg.threadStatus` is the HTTP
      // one (a 500 / 404 read failure). `cfg.threadState` is the THREAD's own lifecycle field —
      // `task.status`, ThreadStatus 'open' | 'closed' — and it is ABSENT unless a test sets it,
      // which is exactly the shape a server that predates the field sends. Read at CALL time, so
      // a test can close (or reopen) a thread between two reads.
      if (pathname.includes("/tasks/")) {
        if (cfg.threadStatus && cfg.threadStatus !== 200) return { ok: false, status: cfg.threadStatus };
        if (cfg.participants === undefined) return { ok: false, status: 404 };
        const task = { id: THREAD, participants: cfg.participants };
        if (cfg.threadState !== undefined) task.status = cfg.threadState;
        return { ok: true, status: 200, json: async () => ({ task }) };
      }
      if (cfg.rosterStatus && cfg.rosterStatus !== 200) return { ok: false, status: cfg.rosterStatus };
      return { ok: true, status: 200, json: async () => ({ agents: rosterRows }) };
    },
    normalizeList: (data, key) => (Array.isArray(data) ? data : (data && data[key]) || []),
    displayNameFor: (id) => (id === ME ? "Samuel" : "David"),
    // FIX B1: the durable last-known count. A fake object stands in for electron-store, so
    // the persistence rule (only a SUCCESSFUL read writes; a zero deletes) is driven for real.
    getTeamAgentCount: (id) => Number(durable[id]) || 0,
    setTeamAgentCount: (id, n) => {
      calls.persisted.push({ id, n });
      if (Number(n) > 0) durable[id] = Number(n);
      else delete durable[id];
    },
  };
  const targeting = {
    metaStr: (m, k) => {
      const v = m && m.metadata ? m.metadata[k] : undefined;
      return typeof v === "string" && v.trim() ? v.trim() : "";
    },
    resolveToolProfile: () => "full",
    // The REAL UUID gate, restated: a legacy `task-<channel>-<seq>` id must never select the
    // thread lane, and a fake that just returned metadata.taskId would hide that.
    firstClassTaskId: (m) => {
      const v = m && m.metadata ? m.metadata.taskId : undefined;
      const id = typeof v === "string" ? v.trim() : "";
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
    },
  };
  const settings = { getWindowMode: () => cfg.windowMode !== false };
  const live = new Set(cfg.live || []);
  const sessionEngine = {
    // THE ARRIVAL. It opens nothing and starts nothing — it posts into the channel — so a
    // successful summon must NOT put a session in `live`.
    summonTeamSession: async (a) => {
      calls.summon.push(a);
      if (cfg.summonSkip) return { skipped: cfg.summonSkip };
      return { greeted: true };
    },
    // THE WAKE. This is the only thing that opens a team agent's session.
    wakeTeamSession: async (a) => {
      calls.wake.push(a);
      if (cfg.wakeSkip) return { skipped: cfg.wakeSkip };
      live.add(`${a.channelId}:${a.agentId}`);
      return { sessionId: "sess-1" };
    },
    hasLiveSession: (a) => live.has(`${a.channelId}:${a.agentId || a.taskId || ""}`),
    acceptsInboundFrom: (a, author) => cfg.accepts !== false && !!author,
    feedInbound: (a) => {
      calls.feed.push(a);
      return cfg.fed !== false;
    },
  };
  const diag = (...args) => calls.diag.push(args.join(" "));

  // The REAL leaf modules, evaluated fresh per harness so their state is per-test.
  const engagement = new Function(
    `${ENGAGEMENT.block}\n return { ENGAGEMENT_TTL_MS, ENGAGEMENT_ACT_CAP, CHAT_INTENT, addressedAgentIds,` +
      ` engagedAtFor, isChat, humanAuthored, isEngaged, mayEngage, engagedTargets, noteAgentActed };`
  )();
  const threads = new Function(
    "io", "diag",
    `${THREADS.block}\n return { CACHE_TTL_MS, FAIL_BACKOFF_MS, CACHE_CAP, myAgentParticipants,` +
      ` threadIsClosed, fetchParticipants, participantsFor };`
  )(io, diag);
  const roster = new Function(
    "io", "diag",
    `${ROSTER.block}\n return { SUMMONED, ACTIVE, DISMISSED, isMyLiveAgent, teamAgentCount,` +
      ` summonTargets, noteRoster, rowsFor, setRows, agentById, handleFor, authorLabel,` +
      ` fetchRoster, setStatus };`
  )(io, diag);
  // THE DELIVERY, real: the self-echo filter and the author label the routing suites assert on
  // are the shipped ones, driven through the same fake engine.
  const deliver = new Function(
    "io", "targeting", "sessionEngine", "engagement", "roster", "diag",
    `${DELIVER.block}\n return { agentSpec, wakeTeamAgent, selfEcho, deliverToAgent };`
  )(io, targeting, sessionEngine, engagement, roster, diag);

  const api = new Function(
    "settings", "targeting", "engagement", "roster", "threads", "deliver", "sessionEngine", "diag",
    `${AGENTS.block}\n return { reconcileChannel, reconcileAll, wakeChannel,` +
      ` routeAddressedAgent, routeThread, myOwnAgentSpoke, strongest };`
  )(settings, targeting, engagement, roster, threads, deliver, sessionEngine, diag);

  // What channel-listener.js seeds a fresh loop entry with (io.getTeamAgentCount).
  return { ...roster, ...engagement, ...threads, ...deliver, ...api, calls, live, durable, getTeamAgentSeed: io.getTeamAgentCount };
}

/** Seed the roster the router reads, then forget the summon that did it. */
export async function routed(cfg = {}) {
  const h = harness(cfg);
  const e = entry();
  await h.reconcileChannel(e, ME);
  h.calls.summon.length = 0;
  h.calls.wake.length = 0;
  h.calls.feed.length = 0;
  return { h, e };
}

export { assert };
