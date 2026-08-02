// THE OPERATOR'S OWN TYPED REQUEST OPENS A PINNED SHELL (2026-08-02).
//
// THE GAP THIS CLOSES. When the operator typed a request in the app's own web view — a titled
// thread addressed to a peer — their machine opened NOTHING. Clicking the thread later showed
// history with no session, and the peer's accept or decline was invisible until a reply landed.
//
// THE ROOT CAUSE, and it is one conjunct: targeting.requesterTaskOpen requires
// metadata.runtime === 'desktop-session'. That stamp is written server-side from the
// X-Dopl-Runtime header, which only main/sdk-loader.js and main/mcp-config.js send — the two
// places a DESKTOP-SPAWNED session's credential is assembled. The web view posts from the
// browser context (cookies, no such header), so the server stamps no runtime key at all and the
// operator's own typed request is indistinguishable, to that predicate, from a thread their
// EXTERNAL Claude Code session opened. Q3b added the conjunct precisely so the external case
// opens nothing (that session awaits its own reply and a desktop window would steal it), so the
// fix cannot be to relax it.
//
// SO THERE ARE TWO PREDICATES, and this file pins that they are exclusive in BOTH directions:
//   requesterTaskOpen  — STAMPED. Launches a full requester SESSION that drives the thread.
//   requesterShellOpen — UNSTAMPED **and human-typed**. Opens a PINNED SHELL: window plus
//                        transcript, agent NOT started, waking lazily like any parked shell.
// The only thing on the wire separating the operator's typed request from an external agent's
// create is the AUTHOR KIND, which is caller-assertable — which is exactly why the outcome is a
// shell that starts nothing rather than a session that spends tokens.
//
// METHOD: the repo's source-extraction idiom. targeting.js is dependency-free so the REAL
// predicate is required; the SESSION-DISPATCH-PURE block is sliced and driven with fakes; the
// listener's dispatch body is mirrored and the mirror is pinned against the real source, so a
// reordering of listener-messages.js fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const LISTENER = M("listener-messages.js");
const DISPATCH = M("session-dispatch.js");
const TARGETING = M("targeting.js");
const LEGACY_SRC = M("legacy-threads.js");

const require = createRequire(import.meta.url);
const targeting = require("../main/targeting.js"); // dependency-free; the REAL predicates

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const THIRD = "33333333-3333-3333-3333-333333333333";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// ── 1. the predicate's truth table ───────────────────────────────────────────────

// The canonical shape: I typed it, the server resolved my thread, it names a peer, and there is
// no runtime stamp because a browser fetch carries no X-Dopl-Runtime header.
// `has` rather than `!== undefined` so a test can knock a field out with an explicit
// `undefined` — the shape a build that stopped sending it would produce.
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const typed = (over = {}) => ({
  kind: over.kind || "message",
  authorUserId: has(over, "authorUserId") ? over.authorUserId : ME,
  authorKind: has(over, "authorKind") ? over.authorKind : "user",
  body: "please look at the deploy",
  seq: 41,
  metadata: {
    taskId: has(over, "taskId") ? over.taskId : TASK,
    taskCreatedBy: has(over, "taskCreatedBy") ? over.taskCreatedBy : ME,
    taskTarget: has(over, "taskTarget") ? over.taskTarget : PEER,
    taskTitle: "Deploy check",
    to_user_id: PEER,
    ...(over.runtime ? { runtime: over.runtime } : {}),
    ...(over.authorAgentId ? { author_agent_id: over.authorAgentId } : {}),
    ...(over.metadata || {}),
  },
});

const opens = (m) => targeting.requesterShellOpen(m, ME);

test("the canonical case -> true: I typed it, it opened my thread, it names a peer", () => {
  assert.equal(opens(typed()), true);
});

test("Q3b DIRECTION 1 — an EXTERNAL AGENT session's create opens NOTHING", () => {
  // An MCP-credentialed session posts author_kind 'agent' (service-writes.ts derives it from
  // ctx.source), and that session awaits its own reply. A window here would steal it.
  assert.equal(opens(typed({ authorKind: "agent" })), false);
  // ...and neither does an as_agent-attributed post from a COOKIE session, which is a human
  // credential carrying agent authorship. author_agent_id is server-stamped from a validated
  // authorAgentId, so declaring 'user' beside it rescues nothing.
  assert.equal(opens(typed({ authorAgentId: "agent-row-1" })), false);
  assert.equal(opens(typed({ authorKind: "agent", authorAgentId: "agent-row-1" })), false);
  // Any other author kind is refused outright, exactly like classify's guard does.
  for (const kind of ["system", "", null, undefined, 7, {}]) {
    assert.equal(opens(typed({ authorKind: kind })), false, `authorKind ${JSON.stringify(kind)}`);
  }
});

test("Q3b DIRECTION 2 — a DESKTOP-SPAWNED session's create is still the OTHER predicate's", () => {
  // The stamped case launches a full requester session (requesterTaskOpen) which manages its
  // own window. This must never open a second, competing shell over it.
  const stamped = typed({ runtime: "desktop-session" });
  assert.equal(opens(stamped), false, "no shell for a thread that already gets a session");
  assert.equal(targeting.requesterTaskOpen(stamped, ME), true, "and the session path is untouched");
  // Padding is trimmed by metaStr, so a padded stamp is still the desktop runtime on both sides.
  assert.equal(opens(typed({ runtime: "  desktop-session  " })), false);
});

test("Q3b DIRECTION 3 — UNSTAMPED and HUMAN-TYPED is the ONLY thing the shell opens for", () => {
  // The counter-check on the pair: exactly one of the two predicates answers true for any one
  // message, and for an external agent's create neither does.
  const cases = [
    { m: typed(), shell: true, session: false, why: "typed in the web view" },
    { m: typed({ runtime: "desktop-session" }), shell: false, session: true, why: "desktop session" },
    { m: typed({ authorKind: "agent" }), shell: false, session: false, why: "external agent" },
  ];
  for (const c of cases) {
    assert.equal(opens(c.m), c.shell, `shell for ${c.why}`);
    assert.equal(targeting.requesterTaskOpen(c.m, ME), c.session, `session for ${c.why}`);
  }
});

test("the identity conjuncts are the real bound, and each is load bearing", () => {
  assert.equal(opens(typed({ authorUserId: PEER })), false, "a peer's create is a RESPONDER trigger");
  assert.equal(opens(typed({ taskCreatedBy: PEER })), false, "a thread I did not open");
  assert.equal(opens(typed({ taskTarget: ME })), false, "a self-addressed thread has no counterparty");
  assert.equal(opens(typed({ taskTarget: "" })), false, "and an unaddressed one has none either");
  const noTarget = typed();
  delete noTarget.metadata.taskTarget;
  assert.equal(opens(noTarget), false);
  assert.equal(targeting.requesterShellOpen(typed(), null), false, "identity not resolved yet");
  assert.equal(targeting.requesterShellOpen(typed(), ""), false);
  assert.equal(targeting.requesterShellOpen(null, ME), false);
});

test("first-class threads only, and a non-message kind is never an opener", () => {
  assert.equal(opens(typed({ taskId: `task-${TASK}-7` })), false, "a legacy id is not a thread row");
  assert.equal(opens(typed({ taskId: "" })), false);
  assert.equal(opens(typed({ taskId: TASK.slice(0, -1) })), false);
  for (const kind of ["task_started", "task_failed", "task_finished"]) {
    assert.equal(opens(typed({ kind })), false, kind);
  }
});

test("server-stamped keys are read as strings; a spoofed non-string is ignored", () => {
  assert.equal(opens(typed({ taskTarget: 123 })), false);
  assert.equal(opens(typed({ taskCreatedBy: { id: ME } })), false);
  assert.equal(opens({ ...typed(), metadata: undefined }), false);
});

// ── 2. the listener's order ──────────────────────────────────────────────────────

test("the shell route runs AFTER the three existing routes and BEFORE classify", () => {
  const at = (needle) => {
    const i = LISTENER.indexOf(needle);
    assert.notEqual(i, -1, `dispatch site missing from listener-messages.js: ${needle}`);
    return i;
  };
  const strip = at("sessionDispatch.noteRequestLifecycle(entry, m, myUserId);");
  const feed = at("if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;");
  const open = at("if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;");
  const surface = at("if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;");
  const shell = at("if (await sessionDispatch.maybeOpenRequesterShell(entry, m, myUserId)) return;");
  const classify = at("const verdict = targeting.classify(m, entry, myUserId);");
  assert.ok(strip < feed, "the strip is OBSERVED before any route can claim the message");
  assert.ok(open < shell, "the stamped route claims a desktop-spawned create first");
  assert.ok(surface < shell, "and the shell is the last of the four");
  assert.ok(shell < classify, "classify still runs LAST");
});

test("the strip observation is a statement, not a route: its result is never branched on", () => {
  // It must not gain an `if (...) return;` — the events it reads belong to other routes, and
  // swallowing a peer's reply here would lose the message the operator is waiting for.
  assert.ok(!LISTENER.includes("if (sessionDispatch.noteRequestLifecycle"),
    "noteRequestLifecycle must never short-circuit the dispatch");
});

// ── 3. the routing, driven through the REAL block ────────────────────────────────

const BEGIN = "// ─── BEGIN SESSION-DISPATCH-PURE";
const END = "// ─── END SESSION-DISPATCH-PURE";
const from = DISPATCH.indexOf(BEGIN);
const to = DISPATCH.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-DISPATCH-PURE sentinels missing");
const BLOCK = DISPATCH.slice(from, to);

// classify / metaStr are private in targeting.js — brace-balance them out (the classify.test
// idiom) so the mirror below runs the REAL verdict logic for everything the routes decline.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function ${name} not found`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  return src.slice(start, i);
}
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
const { classify } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${LEGACY}\n${extractFn(TARGETING, "classify")}\nreturn { classify };`
)();

function harness(over = {}) {
  const cfg = { windowMode: true, live: false, shellOk: { ok: true }, stripMoved: true, ...over };
  const calls = { feed: [], launch: [], gate: [], shell: [], strip: [], notify: [], diag: [], trigger: [], fyi: [], taskNotify: [] };
  const settings = { getWindowMode: () => cfg.windowMode };
  const sessionEngine = {
    hasLiveSession: () => cfg.live,
    counterpartyFor: () => PEER,
    feedInbound: (a) => { calls.feed.push(a); return true; },
    launchRequesterSession: async (a) => { calls.launch.push(a); return { sessionId: "sess-1" }; },
    feedInboundForTask: async (a) => { calls.gate.push(a); return false; },
    openRequesterShell: async (a) => { calls.shell.push(a); return cfg.shellOk; },
    noteRequestStatus: (slot, status) => { calls.strip.push({ ...slot, status }); return cfg.stripMoved; },
  };
  const io = { displayNameFor: (id) => `name:${id}` };
  const roster = { authorLabel: (c, m) => (m.authorKind === "agent" ? `agent-of:${m.authorUserId}` : `name:${m.authorUserId}`) };
  const notifyLocal = (title, body) => calls.notify.push({ title, body });
  const routes = new Function(
    "settings", "targeting", "sessionEngine", "io", "roster", "notifyLocal", "diag",
    `${BLOCK}\n return { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply, maybeOpenRequesterShell, noteRequestLifecycle };`
  )(settings, targeting, sessionEngine, io, roster, notifyLocal, (...a) => calls.diag.push(a.join(" ")));

  // listener-messages.js dispatchMessage, mirrored (its order is pinned above).
  async function dispatch(entry, m) {
    routes.noteRequestLifecycle(entry, m, ME);
    if (routes.feedLiveSession(entry, m, ME)) return "feedLiveSession";
    if (await routes.maybeOpenRequesterSession(entry, m, ME)) return "maybeOpenRequesterSession";
    if (await routes.maybeSurfaceRequesterReply(entry, m, ME)) return "maybeSurfaceRequesterReply";
    if (await routes.maybeOpenRequesterShell(entry, m, ME)) return "maybeOpenRequesterShell";
    const verdict = classify(m, entry, ME);
    if (verdict === "trigger") calls.trigger.push(m);
    else if (verdict === "fyi") calls.fyi.push(m);
    else if (verdict === "task-reply") calls.taskNotify.push(m);
    return `classify:${verdict}`;
  }
  return { dispatch, routes, calls, cfg };
}

const entry = { channel: { id: "cccccccc-1111-2222-3333-444444444444", name: "Ops", memberCount: 2, isMember: true }, workspaceId: "w1" };

test("a HUMAN-TYPED request opens the shell, with the peer bound and the thread named", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, typed()), "maybeOpenRequesterShell");
  assert.equal(h.calls.shell.length, 1);
  const spec = h.calls.shell[0];
  assert.equal(spec.channelId, entry.channel.id);
  assert.equal(spec.taskId, TASK);
  assert.equal(spec.workspaceId, "w1");
  assert.equal(spec.counterpartyId, PEER, "FIX L1: only this member's replies may feed the shell");
  assert.equal(spec.direct, false, "a group channel does not claim the DM auto-address");
  assert.deepEqual(spec.context, {
    channelName: "Ops", taskTitle: "Deploy check", authorName: `name:${PEER}`,
    channelId: entry.channel.id, workspaceId: "w1", taskId: TASK,
  });
  // Nothing that could START anything was reached.
  assert.deepEqual([h.calls.launch.length, h.calls.feed.length, h.calls.gate.length], [0, 0, 0]);
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.taskNotify.length], [0, 0, 0]);
});

test("an EXTERNAL AGENT's create still opens NOTHING — Q3b does not regress", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, typed({ authorKind: "agent" })), "classify:ignore");
  assert.deepEqual(h.calls.shell, [], "no shell may race the awaiting external session");
  assert.deepEqual(h.calls.launch, [], "and no session either");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.taskNotify.length], [0, 0, 0]);
  assert.deepEqual(h.calls.notify, [], "and no local banner for my own message");
});

test("a DESKTOP-SPAWNED create keeps today's behaviour exactly: a session, and no shell", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, typed({ runtime: "desktop-session" })), "maybeOpenRequesterSession");
  assert.equal(h.calls.launch.length, 1, "the stamped route still claims it");
  assert.equal(h.calls.launch[0].taskId, TASK);
  assert.deepEqual(h.calls.shell, [], "and the shell route is never reached for it");
});

test("one shell per thread: a live session short-circuits without opening a second window", async () => {
  const h = harness({ live: true });
  assert.equal(await h.dispatch(entry, typed()), "maybeOpenRequesterShell");
  assert.deepEqual(h.calls.shell, [], "the registry already has this thread");
});

test("window-mode OFF opens nothing and calls the engine not at all", async () => {
  const h = harness({ windowMode: false });
  assert.equal(await h.dispatch(entry, typed()), "classify:ignore");
  assert.deepEqual(h.calls.shell, []);
  assert.deepEqual(h.calls.strip, []);
});

test("a refused open falls through to today's behaviour and names the reason", async () => {
  const h = harness({ shellOk: { ok: false, reason: "busy" } });
  assert.equal(await h.dispatch(entry, typed()), "classify:ignore", "my own message classifies ignore");
  const line = h.calls.diag.find((d) => d.includes("requester shell not opened"));
  assert.match(line, /reason busy/);
});

// ── 4. the diag ─────────────────────────────────────────────────────────────────

test("the diag is one line per auto-open: 8-char ids, and no bodies", async () => {
  const h = harness();
  await h.dispatch(entry, typed());
  const lines = h.calls.diag.filter((d) => d.includes("requester shell opened"));
  assert.equal(lines.length, 1, "exactly one line per auto-open");
  assert.equal(lines[0], `requester shell opened ${entry.channel.id.slice(0, 8)} thread ${TASK.slice(0, 8)}`);
  for (const d of h.calls.diag) {
    assert.ok(!d.includes("please look at the deploy"), "no request body reaches the log");
    assert.ok(!d.includes("Deploy check"), "and no thread title");
    assert.ok(!d.includes(PEER), "and no full member id");
    assert.ok(!d.includes(TASK), "ids are prefixes, never whole");
  }
});

// ── 5. the lifecycle observation ────────────────────────────────────────────────

const peerEvent = (kind, over = {}) => ({
  kind,
  authorUserId: has(over, "authorUserId") ? over.authorUserId : PEER,
  authorKind: "agent",
  body: "",
  seq: 42,
  metadata: { taskId: TASK, taskCreatedBy: ME, taskTarget: PEER, ...(over.metadata || {}) },
});

test("the peer's task_started is Accepted, a declined task_failed is Declined", async () => {
  const started = harness();
  await started.dispatch(entry, peerEvent("task_started"));
  assert.deepEqual(started.calls.strip, [{ channelId: entry.channel.id, taskId: TASK, status: "accepted" }]);

  const declined = harness();
  await declined.dispatch(entry, peerEvent("task_failed", { metadata: { declined: true } }));
  assert.deepEqual(declined.calls.strip, [{ channelId: entry.channel.id, taskId: TASK, status: "declined" }]);
});

test("a task_failed with NO declined flag is an ERROR, not a decline: the strip holds", async () => {
  const h = harness();
  await h.dispatch(entry, peerEvent("task_failed"));
  assert.deepEqual(h.calls.strip, [], "v1 has no word for it, so it says nothing rather than the wrong thing");
  // The flag is read STRICTLY: the server only re-stamps a literal `true`.
  const soft = harness();
  await soft.dispatch(entry, peerEvent("task_failed", { metadata: { declined: "yes" } }));
  assert.deepEqual(soft.calls.strip, []);
});

test("the peer's first REPLY is Replied, and the reply still reaches the session", async () => {
  const h = harness({ live: true });
  const reply = { kind: "message", authorUserId: PEER, authorKind: "agent", body: "on it", seq: 43,
    metadata: { taskId: TASK, taskCreatedBy: ME, taskTarget: PEER, to_user_id: ME } };
  assert.equal(await h.dispatch(entry, reply), "feedLiveSession", "route 1 still claims it");
  assert.equal(h.calls.feed.length, 1, "the message is not swallowed by the observation");
  assert.deepEqual(h.calls.strip, [{ channelId: entry.channel.id, taskId: TASK, status: "replied" }]);
});

test("the strip is bound to the PAIR: a third member, or somebody else's thread, moves nothing", async () => {
  const third = harness();
  await third.dispatch(entry, peerEvent("task_started", { authorUserId: THIRD }));
  assert.deepEqual(third.calls.strip, [], "the author must be the member I addressed");

  const notMine = harness();
  await notMine.dispatch(entry, peerEvent("task_started", { metadata: { taskCreatedBy: PEER } }));
  assert.deepEqual(notMine.calls.strip, [], "and the thread must be one I opened");

  const mine = harness();
  await mine.dispatch(entry, { ...peerEvent("task_started"), authorUserId: ME });
  assert.deepEqual(mine.calls.strip, [], "my own milestone is not news about my own request");

  const legacy = harness();
  await legacy.dispatch(entry, peerEvent("task_started", { metadata: { taskId: `task-${TASK}-7` } }));
  assert.deepEqual(legacy.calls.strip, [], "a legacy id resolves no thread row");
});

test("a milestone with an INHERITED key name is not a milestone", async () => {
  // `REQUEST_MILESTONES[m.kind]` on a plain object literal answers a function for 'constructor'.
  for (const kind of ["constructor", "toString", "hasOwnProperty"]) {
    const h = harness();
    await h.dispatch(entry, peerEvent(kind));
    assert.deepEqual(h.calls.strip, [], kind);
  }
});

test("the strip diag names the transition and nothing else", async () => {
  const h = harness();
  await h.dispatch(entry, peerEvent("task_started"));
  const line = h.calls.diag.find((d) => d.startsWith("request strip"));
  assert.equal(line, `request strip ${entry.channel.id.slice(0, 8)} thread ${TASK.slice(0, 8)} accepted`);
  // A transition that did NOT move (an unarmed session — every responder and team shell) is
  // silent: the engine answered false, so there is nothing to report.
  const quiet = harness({ stripMoved: false });
  await quiet.dispatch(entry, peerEvent("task_started"));
  assert.equal(quiet.calls.diag.filter((d) => d.startsWith("request strip")).length, 0);
});
