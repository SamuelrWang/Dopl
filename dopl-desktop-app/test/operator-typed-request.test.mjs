// THE OPERATOR'S OWN TYPED REQUEST STARTS THE AGENT (2026-08-05, rollback plan §3.4).
//
// WHAT CHANGED, AND WHY IT COULD. Three sender-side outcomes used to exist for one action:
//   a DESKTOP-SPAWNED session's create  -> a full requester SESSION (window + agent)
//   the operator TYPING in the app      -> a dormant SHELL (window, agent NOT started)
//   an EXTERNAL MCP session's create    -> nothing
// The middle one was not a product decision. The app's UI posted from a browser context —
// cookies, no `X-Dopl-Runtime` header — so the server stamped no `metadata.runtime`, and the
// operator's typed request was indistinguishable on the wire from an external agent's create.
// The only thing left to route on was `authorKind`, which is CALLER-ASSERTED, and a dormant
// shell was the most that weak evidence could safely buy.
//
// The app owns that renderer now. `main/ui-bridge.js` is the ONE transport the bundled SPA
// has (the preload exposes no header surface; every handler is bound to that window's own top
// frame), so main attaches `X-Dopl-Runtime: desktop-ui` to every call the renderer originates,
// and the server stamps it — refusing that value to any AGENT credential, so an external MCP
// caller cannot buy it by sending the header. The evidence is server-side, so the predicate did
// not have to be LOOSENED to reach the right answer: it still demands a server-written stamp,
// there is simply a second one now, and BOTH desktop runtimes start the agent.
//
// THIS FILE IS THE RED/GREEN. Before the change, "an operator-typed request launches a full
// requester session" fails (it opened a shell). After, the shell predicate, its route and its
// park entry point are DELETED. Case 3 — an EXTERNAL, UNSTAMPED create — must STILL open
// nothing; rollback §3.5 changes that deliberately with an explicit handoff op, and the test
// below is what keeps it from changing by accident in the meantime.
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

// The canonical shape: I typed it in the app, the server resolved my thread and stamped the
// runtime, and it names a peer.
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
    ...(has(over, "runtime") ? { runtime: over.runtime } : { runtime: "desktop-ui" }),
    ...(over.authorAgentId ? { author_agent_id: over.authorAgentId } : {}),
    ...(over.metadata || {}),
  },
});

const opens = (m) => targeting.requesterTaskOpen(m, ME);

test("GREEN: the operator's typed request opens a full requester session", () => {
  assert.equal(opens(typed()), true);
});

test("the shell predicate is GONE, not merely unused", () => {
  // Deleting the route while leaving the predicate exported is the dead tissue this change
  // set out not to leave behind.
  assert.equal(targeting.requesterShellOpen, undefined, "requesterShellOpen must not exist");
  assert.ok(!TARGETING.includes("requesterShellOpen"), "and no trace of it in the source");
  assert.ok(!DISPATCH.includes("maybeOpenRequesterShell"), "nor its route");
  assert.ok(!LISTENER.includes("maybeOpenRequesterShell"), "nor its listener call");
  assert.ok(!M("session-park.js").includes("async function openRequesterShell"),
    "nor its park entry point");
});

test("BOTH desktop runtimes open the session; nothing else does", () => {
  assert.deepEqual(targeting.DESKTOP_RUNTIMES, ["desktop-session", "desktop-ui"],
    "the two stamps this app produces, and only those two");
  assert.equal(opens(typed({ runtime: "desktop-session" })), true, "a spawned session, unchanged");
  assert.equal(opens(typed({ runtime: "desktop-ui" })), true, "and the operator's own typing");
  // Padding is trimmed by metaStr, so a padded stamp is still the same runtime on both sides.
  assert.equal(opens(typed({ runtime: "  desktop-ui  " })), true);
});

test("CASE 3 — an EXTERNAL, UNSTAMPED create still opens NOTHING (rollback §3.5 is later)", () => {
  // The operator's own external Claude Code session sends no runtime header, awaits the reply
  // itself, and a window opened here would steal it. Absent key, empty string, whitespace and a
  // missing metadata bag all refuse.
  const noKey = typed();
  delete noKey.metadata.runtime;
  assert.equal(opens(noKey), false, "no stamp, no window");
  assert.equal(opens(typed({ runtime: "" })), false);
  assert.equal(opens(typed({ runtime: "   " })), false);
  assert.equal(opens({ ...typed(), metadata: undefined }), false);
  // ...and the author kind rescues nothing in either direction: what refuses here is the
  // STAMP, so an unstamped create opens nothing whether a person or an agent claims it.
  assert.equal(opens({ ...noKey, authorKind: "agent" }), false);
  assert.equal(opens({ ...noKey, authorKind: "user" }), false);
});

// ── 1b. SPAWN-WITH-HANDOFF inverts CASE 3 — but only when DECLARED (rollback §3.5) ──
// An external unstamped create carrying the server-stamped handoff flag = the operator
// handing the thread to a window HERE.
const handoff = (over = {}) => {
  const m = typed(over);
  delete m.metadata.runtime;
  m.metadata.handoff = true;
  return m;
};

test("a declared handoff opens the session; read strictly; identity pair still binds", () => {
  assert.equal(opens(handoff()), true, "the CASE 3 inversion — a declared handoff opens it");
  for (const bad of [false, "true", 1, "yes", 0, null, undefined]) { // strict: only true stamps
    const m = handoff();
    m.metadata.handoff = bad;
    assert.equal(opens(m), false, `handoff ${JSON.stringify(bad)}`);
  }
  // it clears the STAMP conjunct only, never the identity pair (the wrong-machine guard):
  assert.equal(opens(handoff({ authorUserId: PEER })), false, "a peer's create, flag or not");
  assert.equal(opens(handoff({ taskCreatedBy: PEER })), false, "a thread I did not open");
  assert.equal(opens(handoff({ taskTarget: ME })), false, "a self-addressed thread");
  assert.equal(opens(handoff({ taskId: `task-${TASK}-7` })), false, "a legacy id is no thread");
});

test("a FORGED or near-miss runtime value opens nothing — exact match only", () => {
  for (const bad of [
    "desktop",
    "Desktop-UI",
    "DESKTOP-UI",
    "desktop-ui-x",
    "desktop-session-x",
    "desktop_ui",
    "external",
    "web",
    123,
    true,
    { runtime: "desktop-ui" },
    ["desktop-ui"],
  ]) {
    assert.equal(opens(typed({ runtime: bad })), false, `runtime ${JSON.stringify(bad)}`);
  }
});

test("the identity conjuncts are still the real bound, and each is load bearing", () => {
  // The stamp is a ROUTING HINT (src/shared/auth/runtime-header.ts): a correct one rescues
  // nothing, so the AND is not accidentally an OR.
  assert.equal(opens(typed({ authorUserId: PEER })), false, "a peer's create is a RESPONDER trigger");
  assert.equal(opens(typed({ taskCreatedBy: PEER })), false, "a thread I did not open");
  assert.equal(opens(typed({ taskTarget: ME })), false, "a self-addressed thread has no counterparty");
  assert.equal(opens(typed({ taskTarget: "" })), false, "and an unaddressed one has none either");
  const noTarget = typed();
  delete noTarget.metadata.taskTarget;
  assert.equal(opens(noTarget), false);
  assert.equal(targeting.requesterTaskOpen(typed(), null), false, "identity not resolved yet");
  assert.equal(targeting.requesterTaskOpen(typed(), ""), false);
  assert.equal(targeting.requesterTaskOpen(null, ME), false);
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
});

test("requesterTypedByOperator separates the two runtimes, and gates nothing on its own", () => {
  // It decides ONE display-only thing (arming the request strip). `desktop-session` is not the
  // operator typing, and an unstamped post is not either.
  assert.equal(targeting.requesterTypedByOperator(typed()), true);
  assert.equal(targeting.requesterTypedByOperator(typed({ runtime: "desktop-session" })), false);
  assert.equal(targeting.requesterTypedByOperator(typed({ runtime: "" })), false);
  assert.equal(targeting.requesterTypedByOperator({ metadata: undefined }), false);
});

// ── 2. the listener's order ──────────────────────────────────────────────────────

test("three pre-classify routes, and classify still runs LAST", () => {
  const at = (needle) => {
    const i = LISTENER.indexOf(needle);
    assert.notEqual(i, -1, `dispatch site missing from listener-messages.js: ${needle}`);
    return i;
  };
  const strip = at("sessionDispatch.noteRequestLifecycle(entry, m, myUserId);");
  const feed = at("if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;");
  const open = at("if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;");
  const surface = at("if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;");
  const classify = at("const verdict = targeting.classify(m, entry, myUserId);");
  assert.ok(strip < feed, "the strip is OBSERVED before any route can claim the message");
  assert.ok(feed < open, "feedLiveSession runs first");
  assert.ok(open < surface, "then the requester open");
  assert.ok(surface < classify, "and classify LAST");
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
// ⚠ classify's TWO free variables come along with it. `isChatIntent` (2026-08-06) and
// `mentionsMe` (2026-08-18) are hoisted out of its body so listener-messages.js can ask the
// same questions; omitting either builds a classify that throws a ReferenceError the moment a
// fixture reaches that line, which is a red this file would only ever see by accident.
const { classify } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${LEGACY}\n${extractFn(TARGETING, "isChatIntent")}\n` +
    `${extractFn(TARGETING, "mentionsMe")}\n${extractFn(TARGETING, "classify")}\nreturn { classify };`
)();

function harness(over = {}) {
  const cfg = { windowMode: true, live: false, launchReturn: { sessionId: "sess-1" }, stripMoved: true, ...over };
  const calls = { feed: [], launch: [], gate: [], arm: [], strip: [], notify: [], diag: [], trigger: [], fyi: [], taskNotify: [] };
  const settings = { getWindowMode: () => cfg.windowMode };
  const sessionEngine = {
    hasLiveSession: () => cfg.live,
    counterpartyFor: () => PEER,
    feedInbound: (a) => { calls.feed.push(a); return true; },
    launchRequesterSession: async (a) => { calls.launch.push(a); return cfg.launchReturn; },
    feedInboundForTask: async (a) => { calls.gate.push(a); return false; },
    armRequestStatus: (slot) => { calls.arm.push(slot); return true; },
    noteRequestStatus: (slot, status) => { calls.strip.push({ ...slot, status }); return cfg.stripMoved; },
  };
  const io = { displayNameFor: (id) => `name:${id}` };
  const notifyLocal = (title, body) => calls.notify.push({ title, body });
  const routes = new Function(
    "settings", "targeting", "sessionEngine", "io", "notifyLocal", "diag",
    `${BLOCK}\n return { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply, noteRequestLifecycle };`
  )(settings, targeting, sessionEngine, io, notifyLocal, (...a) => calls.diag.push(a.join(" ")));

  // listener-messages.js dispatchMessage, mirrored (its order is pinned above).
  async function dispatch(entry, m) {
    routes.noteRequestLifecycle(entry, m, ME);
    if (routes.feedLiveSession(entry, m, ME)) return "feedLiveSession";
    if (await routes.maybeOpenRequesterSession(entry, m, ME)) return "maybeOpenRequesterSession";
    if (await routes.maybeSurfaceRequesterReply(entry, m, ME)) return "maybeSurfaceRequesterReply";
    const verdict = classify(m, entry, ME);
    if (verdict === "trigger") calls.trigger.push(m);
    else if (verdict === "fyi") calls.fyi.push(m);
    // The mention gate rides in the mirror too (2026-08-18, wiring plan Phase 7) — a mirror
    // more permissive than prod is how a dispatcher divergence stays green here.
    else if (verdict === "task-reply" && targeting.mentionsMe(m, ME)) calls.taskNotify.push(m);
    return `classify:${verdict}`;
  }
  return { dispatch, routes, calls, cfg };
}

const entry = { channel: { id: "cccccccc-1111-2222-3333-444444444444", name: "Ops", memberCount: 2, isMember: true }, workspaceId: "w1" };

test("GREEN: a typed request LAUNCHES the agent, with the peer bound and the thread named", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, typed()), "maybeOpenRequesterSession");
  assert.equal(h.calls.launch.length, 1);
  const spec = h.calls.launch[0];
  assert.equal(spec.channelId, entry.channel.id);
  assert.equal(spec.taskId, TASK);
  assert.equal(spec.workspaceId, "w1");
  assert.equal(spec.goal, "please look at the deploy", "the operator's own words are the first turn");
  assert.equal(spec.counterpartyId, PEER, "FIX L1: only this member's replies may feed the session");
  assert.equal(spec.direct, false, "a group channel does not claim the DM auto-address");
  assert.deepEqual(spec.context, {
    channelName: "Ops", targetName: `name:${PEER}`, taskTitle: "Deploy check",
    channelId: entry.channel.id, workspaceId: "w1", taskId: TASK,
  });
  // ...and the request strip opens at "sent" for it — the peer's Accept/Decline arrive as
  // milestones no route can feed to the running agent.
  assert.deepEqual(h.calls.arm, [{ channelId: entry.channel.id, taskId: TASK }]);
});

test("a DESKTOP-SPAWNED create takes the IDENTICAL launch, and arms no strip", async () => {
  // The path this change must not perturb. Same route, same spec — the only difference is the
  // display-only strip, which says "the request I typed" and is not a statement a session's
  // own create is making.
  const h = harness();
  assert.equal(await h.dispatch(entry, typed({ runtime: "desktop-session" })), "maybeOpenRequesterSession");
  assert.equal(h.calls.launch.length, 1);
  assert.equal(h.calls.launch[0].taskId, TASK);
  assert.deepEqual(h.calls.arm, [], "a spawned session narrates in its own window");
});

test("CASE 3 — an EXTERNAL, UNSTAMPED create reaches NO route and starts nothing", async () => {
  const unstamped = typed();
  delete unstamped.metadata.runtime;
  for (const authorKind of ["agent", "user"]) {
    const h = harness();
    assert.equal(await h.dispatch(entry, { ...unstamped, authorKind }), "classify:ignore", authorKind);
    assert.deepEqual(h.calls.launch, [], "no window may race the awaiting external session");
    assert.deepEqual(h.calls.arm, []);
    assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.taskNotify.length], [0, 0, 0]);
    assert.deepEqual(h.calls.notify, [], "and no local banner for my own message");
  }
});

test("HANDOFF dispatch: an external declared-handoff create LAUNCHES, and arms no strip", async () => {
  // §3.5: route (2) claims it, NO strip (that is for `desktop-ui` typing), no skew diag.
  const h = harness();
  const m = typed();
  delete m.metadata.runtime;
  m.metadata.handoff = true;
  assert.equal(await h.dispatch(entry, m), "maybeOpenRequesterSession");
  assert.equal(h.calls.launch.length, 1);
  assert.deepEqual(h.calls.arm, []);
  assert.equal(h.calls.diag.filter((d) => d.includes("metadata.runtime")).length, 0);
});

test("one session per thread: a live session short-circuits without opening a second window", async () => {
  const h = harness({ live: true });
  assert.equal(await h.dispatch(entry, typed()), "maybeOpenRequesterSession");
  assert.deepEqual(h.calls.launch, [], "the registry already has this thread");
  assert.deepEqual(h.calls.arm, [], "and a dedupe is not a fresh request");
});

test("window-mode OFF opens nothing and calls the engine not at all", async () => {
  const h = harness({ windowMode: false });
  assert.equal(await h.dispatch(entry, typed()), "classify:ignore");
  assert.deepEqual(h.calls.launch, []);
  assert.deepEqual(h.calls.arm, []);
  assert.deepEqual(h.calls.strip, []);
});

test("a refused launch falls through to today's behaviour, and arms no strip", async () => {
  const h = harness({ launchReturn: { skipped: "cap" } });
  assert.equal(await h.dispatch(entry, typed()), "classify:ignore", "my own message classifies ignore");
  assert.deepEqual(h.calls.arm, [], "no window, nothing to put a status line on");
  assert.equal(h.calls.notify.length, 1, "and the cap says so, passively");
});

// ── 4. the diag ─────────────────────────────────────────────────────────────────

test("an unstamped create names the stamp it saw (FIX L3), and leaks nothing", async () => {
  const unstamped = typed();
  delete unstamped.metadata.runtime;
  const h = harness();
  await h.dispatch(entry, unstamped);
  const line = h.calls.diag.find((d) => d.includes("metadata.runtime"));
  assert.ok(line, "the runtime refusal must name itself");
  assert.match(line, /\(absent\)/);
  assert.match(line, /desktop-session/, "and say what it was looking for");
  assert.match(line, /desktop-ui/);
  for (const d of h.calls.diag) {
    assert.ok(!d.includes("please look at the deploy"), "no request body reaches the log");
    assert.ok(!d.includes("Deploy check"), "and no thread title");
    assert.ok(!d.includes(PEER), "and no full member id");
  }
});

test("a WRONG value is named verbatim — that is what distinguishes skew from external", async () => {
  const h = harness();
  await h.dispatch(entry, typed({ runtime: "desktop" }));
  const line = h.calls.diag.find((d) => d.includes("metadata.runtime"));
  assert.match(line, /'desktop'/);
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
  // A transition that did NOT move (an unarmed session — every responder, every team shell,
  // every session a SPAWNED create opened) is silent: the engine answered false.
  const quiet = harness({ stripMoved: false });
  await quiet.dispatch(entry, peerEvent("task_started"));
  assert.equal(quiet.calls.diag.filter((d) => d.startsWith("request strip")).length, 0);
});
