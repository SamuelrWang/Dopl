// WAKE-V1 — the EXTERNAL-requester fallback. A thread opened by the operator's own
// external Claude Code session must open NO desktop requester window, and the peer's
// reply must still surface as the passive OS notification.
//
// WHY THIS FILE EXISTS. WAKE-V1 makes an external session await its own reply (a
// long-held MCP call that wakes it when the peer answers), so targeting.requesterTaskOpen
// now demands metadata.runtime === 'desktop-session' before auto-opening a requester
// window — otherwise a desktop window races the waiting session for the same reply.
// Removing that window removes the ONE route that used to claim these messages, which
// puts the whole burden on the listener's remaining dispatch order. The risk this file
// closes: a reply that is no longer claimed by a window and is ALSO swallowed by one of
// the other two pre-classify routes would reach neither agent nor operator — silently
// lost, with the listener's cursor already advanced past it. So both halves are pinned:
// the ORDER (statically, against listener-messages.js) and the OUTCOME (behaviorally,
// through the real routing + the real classify).
//
// SPLIT NOTE (Q10): the dispatch body moved out of channel-listener.js into
// listener-messages.js when that file hit the 500-line cap, and the `continue`s became
// `return`s. Same order, same short-circuits; the pins below were repointed with it.
//
// THE TRACE this file locks in, for a thread an EXTERNAL session created:
//   listener-messages.js feedLiveSession           -> false (no window was ever spawned,
//                                                     so no live session for this task)
//   listener-messages.js maybeOpenRequesterSession -> false (requesterTaskOpen refuses
//                                                     the unstamped create, and the reply
//                                                     is not my own message anyway)
//   listener-messages.js maybeSurfaceRequesterReply -> false (the engine finds NO
//                                                     durable record on this machine:
//                                                     session-park recreateParkedShell
//                                                     returns {ok:false}, session-gate
//                                                     feedInboundForTask returns false)
//   listener-messages.js classify                  -> 'task-reply'
//   listener-messages.js taskNotify.notifyTaskReply — the passive silent banner.
//
// METHOD: the repo's source-extraction idiom. targeting.js is dependency-free so it is
// required for real (the runtime gate must be the REAL one here, not a fake); the
// SESSION-DISPATCH-PURE block is sliced and driven with fakes standing in for the
// electron-bound engine; the dispatch body is mirrored and the mirror is pinned
// against the real source below, so a reordering of listener-messages.js fails here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const M = (p) => readFileSync(join(HERE, "..", "main", p), "utf8");
const LISTENER = M("listener-messages.js");
const LOOP = M("channel-listener.js");
const DISPATCH = M("session-dispatch.js");
const TARGETING = M("targeting.js");
// §2 SPLIT (2026-07-31): the LEGACY-THREADS registry moved out of targeting.js when that
// file went past the 500-line cap; classify still calls into it as free variables.
const LEGACY_SRC = M("legacy-threads.js");
const GATE = M("session-gate.js");
const PARK = M("session-park.js");

const require = createRequire(import.meta.url);
const targeting = require("../main/targeting.js"); // dependency-free; the REAL gate

// ── STATIC PIN 1: the listener's dispatch ORDER ──────────────────────────────────
// The mirror below is only meaningful if it matches the real loop. These pin the four
// call sites in sequence, that each pre-classify route SHORT-CIRCUITS the rest, and that
// the 'task-reply' verdict is wired to the passive notifier.

test("the listener runs the three routes, in order, BEFORE classify", () => {
  const at = (needle) => {
    const i = LISTENER.indexOf(needle);
    assert.notEqual(i, -1, `dispatch site missing from listener-messages.js: ${needle}`);
    return i;
  };
  const feed = at("if (sessionDispatch.feedLiveSession(entry, m, myUserId)) return;");
  const open = at("if (await sessionDispatch.maybeOpenRequesterSession(entry, m, myUserId)) return;");
  const surface = at("if (await sessionDispatch.maybeSurfaceRequesterReply(entry, m, myUserId)) return;");
  const classify = at("const verdict = targeting.classify(m, entry, myUserId);");
  assert.ok(feed < open, "feedLiveSession runs first");
  assert.ok(open < surface, "then maybeOpenRequesterSession");
  assert.ok(surface < classify, "then maybeSurfaceRequesterReply, and classify LAST");
  // …AND THE CHAT GUARD SITS BETWEEN ROUTE 1 AND ROUTE 2 (2026-08-07). This pin used to
  // compare only the three routes, so the mirror below could diverge from prod on the guard
  // with every assertion in this file still green. Chat may be SEEN by a live session
  // (route 1 is deliberately above it) and may never START one (routes 2 and 3 are below).
  const guard = at("const chat = targeting.isChatIntent(m);");
  assert.ok(feed < guard, "the guard must sit AFTER feedLiveSession");
  assert.ok(guard < open, "…and BEFORE the two routes that start a session");
  // …and the loop still AWAITS that dispatch, so a trigger's consent + spawn keeps
  // serializing ahead of the next message in the page (it used to be inline).
  assert.match(LOOP, /await messages\.dispatchMessage\(entry, m, myUserId\);/);
  // Q10's skew read happens BEFORE any route can claim the message — a reply consumed
  // by a live window is exactly the one whose sender's version explains a gap.
  assert.ok(at("versionSkew.observe(entry, m, myUserId);") < feed, "skew is observed first");
});

test("a 'task-reply' verdict reaches the passive notifier, with no consent or spawn", () => {
  assert.match(LISTENER, /else if \(verdict === 'task-reply'\) taskNotify\.notifyTaskReply\(entry, m\);/);
  // The passive path is exactly that: no consent row, no watcher record, no spawn. The
  // strongest available pin is the module's DEPENDENCY set — it cannot reach the consent,
  // spawner or engine machinery because it does not require any of it.
  const NOTIFY = M("task-notify.js");
  const deps = [...NOTIFY.matchAll(/require\('([^']+)'\)/g)].map((x) => x[1]).sort();
  assert.deepEqual(deps, ["./diag", "./listener-io", "./targeting", "electron"],
    "task-notify reaches nothing that could spawn, gate or record a consent");
  // D2 added a SECOND passive verdict on the same module, 'agent-escalation', with the agent
  // handle resolved by the CALLER and passed in precisely so the dependency set above could
  // not grow. It is gone with named agents (channels rollback §1); the DEPENDENCY PIN is what
  // mattered and it still holds.
  assert.ok(!/notifyAgentEscalation/.test(LISTENER), "the escalation dispatch is gone");
});

// ── STATIC PIN 2: "no durable record" really is a FALSE, not a swallow ────────────
// maybeSurfaceRequesterReply returns whatever the engine's gate returns, so the claim
// "it returns false when nothing about this task survives here" bottoms out in these two
// lines. If either flips to a truthy default, the reply gets claimed by a route that
// cannot show it anywhere and the passive notice never fires.

test("with no durable record the gate refuses: recreateParkedShell -> {ok:false} -> false", () => {
  assert.match(PARK, /const rec = store\.getRecord\(key\);/);
  assert.match(PARK, /if \(!rec\) return \{ ok: false \};/, "no record -> no shell");
  assert.match(GATE, /const res = await sessionPark\.recreateParkedShell\(/);
  assert.match(GATE, /if \(!res \|\| !res\.ok\) return false;/, "no shell -> the gate declines");
  // ...and the route hands that refusal straight back to the listener, which then
  // classifies. (No swallow: nothing between the gate's `false` and the `return`.)
  assert.match(DISPATCH, /const ok = await sessionEngine\.feedInboundForTask\(\{/);
  assert.match(DISPATCH, /return ok;\n\}/, "maybeSurfaceRequesterReply returns the gate's verdict verbatim");
});

// ── The behavioral mirror ────────────────────────────────────────────────────────

const BEGIN = "// ─── BEGIN SESSION-DISPATCH-PURE";
const END = "// ─── END SESSION-DISPATCH-PURE";
const from = DISPATCH.indexOf(BEGIN);
const to = DISPATCH.indexOf(END);
assert.ok(from !== -1 && to > from, "SESSION-DISPATCH-PURE sentinels missing");
const BLOCK = DISPATCH.slice(from, to);

// classify / metaStr are private in targeting.js — brace-balance them out (the
// classify.test.mjs idiom) so the mirror runs the REAL verdict logic.
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
// classify also calls the LEGACY-THREADS registry, which carries module state and so is
// sliced whole between its sentinels rather than brace-balanced out function by function.
const LEGACY = LEGACY_SRC.slice(
  LEGACY_SRC.indexOf("// ─── BEGIN LEGACY-THREADS"),
  LEGACY_SRC.indexOf("// ─── END LEGACY-THREADS")
);
assert.ok(LEGACY.includes("function knownLegacyReply"), "LEGACY-THREADS sentinels missing");
// `isChatIntent` (2026-08-06) is a free variable inside classify — hoisted out of its body so
// listener-messages can refuse a chat post ahead of the two session-STARTING routes.
const { classify } = new Function(
  `${extractFn(TARGETING, "metaStr")}\n${LEGACY}\n${extractFn(TARGETING, "isChatIntent")}\n${extractFn(TARGETING, "classify")}\nreturn { classify };`
)();

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const TASK = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

// The listener's loop body (channel-listener.js:152-168), mirrored. Returns everything
// that happened to one message so a test can assert on the WHOLE outcome, not just the
// route that fired.
function harness(over = {}) {
  const cfg = { windowMode: true, live: false, gateReturn: false, ...over };
  const calls = { feed: [], launch: [], gate: [], notifyLocal: [], taskNotify: [], trigger: [], fyi: [], diag: [] };
  const settings = { getWindowMode: () => cfg.windowMode };
  const sessionEngine = {
    hasLiveSession: () => cfg.live,
    counterpartyFor: () => PEER,
    feedInbound: (a) => { calls.feed.push(a); return true; },
    launchRequesterSession: async (a) => { calls.launch.push(a); return { sessionId: "sess-1" }; },
    feedInboundForTask: async (a) => { calls.gate.push(a); return cfg.gateReturn; },
  };
  const io = { displayNameFor: (id) => `name:${id}` };
  // 2026-08-01: a fed message is titled with its AUTHOR, which is not the same string as the
  // account's display name when an AGENT wrote the post. The resolver (`authorLabel`) lives
  // inside the sliced block, so it needs no injection.
  const notifyLocal = (title, body) => calls.notifyLocal.push({ title, body });
  const routes = new Function(
    "settings", "targeting", "sessionEngine", "io", "notifyLocal", "diag",
    `${BLOCK}\n return { feedLiveSession, maybeOpenRequesterSession, maybeSurfaceRequesterReply };`
  )(settings, targeting, sessionEngine, io, notifyLocal, (...a) => calls.diag.push(a.join(" ")));

  // listener-messages.dispatchMessage verbatim in SHAPE (pinned by STATIC PIN 1 above).
  //
  // THE CHAT GUARD IS PART OF THAT SHAPE (2026-08-07, found by audit). This mirror had no
  // guard, so it was strictly MORE PERMISSIVE than prod — and the static pin above only
  // compares the three routes' indexOf positions, which means deleting the guard from
  // listener-messages.js left every assertion in this file green. Only
  // chat-never-starts-a-session.test.mjs (which evaluates the REAL dispatchMessage source)
  // caught it. A divergent copy of a dispatcher is the exact failure this repo already has
  // history with, so the mirror carries the guard too: chat may be SEEN by a live session
  // (route 1) and may never START one (routes 2 and 3).
  async function dispatch(entry, m) {
    if (routes.feedLiveSession(entry, m, ME)) return "feedLiveSession";
    const chat = targeting.isChatIntent(m);
    if (!chat) {
      if (await routes.maybeOpenRequesterSession(entry, m, ME)) return "maybeOpenRequesterSession";
      if (await routes.maybeSurfaceRequesterReply(entry, m, ME)) return "maybeSurfaceRequesterReply";
    }
    const verdict = classify(m, entry, ME);
    if (verdict === "trigger") calls.trigger.push(m);
    else if (verdict === "fyi") calls.fyi.push(m);
    else if (verdict === "task-reply") calls.taskNotify.push(m);
    return `classify:${verdict}`;
  }
  return { dispatch, calls, cfg };
}

const entry = { channel: { id: "c1", name: "General", memberCount: 2, isMember: true }, workspaceId: "w1" };

// My own thread-opening message. `runtime` is the ONE difference between the two
// runtimes: the server stamps it only for a session this app spawned.
const createMsg = (runtime) => ({
  kind: "message", seq: 41, authorUserId: ME, authorKind: "agent", body: "please look at X",
  metadata: {
    taskId: TASK, taskMode: "interactive", taskCreatedBy: ME, taskTarget: PEER, to_user_id: PEER,
    ...(runtime ? { runtime } : {}),
  },
});

// The peer's agent replying in that thread — the message that must not get lost.
const replyMsg = () => ({
  kind: "message", seq: 42, authorUserId: PEER, authorKind: "agent", body: "here is the answer",
  metadata: { taskId: TASK, taskMode: "interactive", taskCreatedBy: ME, taskTarget: PEER, to_user_id: ME },
});

test("EXTERNAL create: no requester window is launched, and nothing else fires either", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, createMsg(null)), "classify:ignore");
  assert.equal(h.calls.launch.length, 0, "no desktop window may race the awaiting external session");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length, h.calls.taskNotify.length], [0, 0, 0]);
  assert.equal(h.calls.notifyLocal.length, 0, "and no local notice for my own message");
});

test("DESKTOP-spawned create still launches its requester window (the gate is not a mute)", async () => {
  const h = harness();
  assert.equal(await h.dispatch(entry, createMsg("desktop-session")), "maybeOpenRequesterSession");
  assert.equal(h.calls.launch.length, 1);
  assert.equal(h.calls.launch[0].taskId, TASK);
  assert.equal(h.calls.launch[0].counterpartyId, PEER);
});

test("EXTERNAL reply: no window, no record -> the PASSIVE notification, not a swallow", async () => {
  const h = harness({ live: false, gateReturn: false });
  await h.dispatch(entry, createMsg(null)); // the external create, ignored as above
  assert.equal(await h.dispatch(entry, replyMsg()), "classify:task-reply");
  assert.equal(h.calls.taskNotify.length, 1, "the operator gets the silent banner");
  assert.equal(h.calls.taskNotify[0].seq, 42);
  // The reply reaches the EXTERNAL agent through its own armed await; this machine must
  // not have spawned or gated anything on its behalf.
  assert.equal(h.calls.launch.length, 0, "no session is launched for a peer reply");
  assert.equal(h.calls.feed.length, 0, "no live session to feed");
  assert.equal(h.calls.gate.length, 1, "the engine was ASKED and found nothing to reopen");
  assert.deepEqual([h.calls.trigger.length, h.calls.fyi.length], [0, 0], "no consent prompt either");
});

test("EXTERNAL reply with window-mode OFF: the same passive notification", async () => {
  // All three routes short-circuit on the setting, so the legacy classify path is the
  // only one running — it must reach the same place.
  const h = harness({ windowMode: false });
  assert.equal(await h.dispatch(entry, replyMsg()), "classify:task-reply");
  assert.equal(h.calls.taskNotify.length, 1);
  assert.equal(h.calls.gate.length, 0, "window-mode OFF never calls the engine at all");
});

test("a DESKTOP-owned thread is unaffected: a live window still eats the reply", async () => {
  // The counter-case that proves the passive path is a FALLBACK, not the new default:
  // when this machine does own the session, the reply is still fed to it.
  const live = harness({ live: true });
  assert.equal(await live.dispatch(entry, replyMsg()), "feedLiveSession");
  assert.equal(live.calls.taskNotify.length, 0, "a fed reply must not ALSO banner");
  // ...and a settled-but-recorded desktop thread still reopens and gates it.
  const settled = harness({ live: false, gateReturn: true });
  assert.equal(await settled.dispatch(entry, replyMsg()), "maybeSurfaceRequesterReply");
  assert.equal(settled.calls.taskNotify.length, 0);
});

// ── FIX L3: the runtime refusal is the one gate rejection with no other symptom ──

test("a create refused ONLY by the runtime stamp says so in the diag", async () => {
  // Every other conjunct that refuses describes a message that was never mine to
  // drive. This one refuses MY create of MY thread and looks exactly like the
  // expected external case — so a server that stops stamping (version skew) would
  // silently stop opening desktop requester windows with nothing in the logs.
  const h = harness();
  await h.dispatch(entry, createMsg(null));
  const line = h.calls.diag.find((d) => d.includes("metadata.runtime"));
  assert.ok(line, "the runtime refusal must name itself");
  assert.match(line, /\(absent\)/, "and report the stamp it actually saw");

  // A WRONG value is named verbatim, which is what distinguishes skew from external.
  const wrong = harness();
  await wrong.dispatch(entry, createMsg("desktop"));
  assert.match(wrong.calls.diag.find((d) => d.includes("metadata.runtime")), /'desktop'/);
});

test("the L3 diag fires ONLY for the runtime conjunct, never for the others", async () => {
  // A peer's create, someone else's task and the stamped happy path must all stay
  // silent — otherwise the line means nothing when it does appear.
  const cases = [
    { ...createMsg(null), authorUserId: PEER },
    { ...createMsg(null), metadata: { ...createMsg(null).metadata, taskCreatedBy: PEER } },
    { ...createMsg(null), metadata: { ...createMsg(null).metadata, taskTarget: ME } },
    createMsg("desktop-session"),
  ];
  for (const m of cases) {
    const h = harness();
    await h.dispatch(entry, m);
    assert.equal(
      h.calls.diag.filter((d) => d.includes("metadata.runtime")).length,
      0,
      `no runtime diag for ${JSON.stringify(m.metadata)}`
    );
  }
});

test("the runtime stamp cannot be forged by the peer into a window on my machine", async () => {
  // A counterparty stamping runtime on THEIR message changes nothing: requesterTaskOpen
  // still requires the message to be MINE and the task to be mine. (The stamp is
  // server-written anyway; this pins that the gate is an AND, not a shortcut.)
  const h = harness();
  const forged = { ...replyMsg(), metadata: { ...replyMsg().metadata, runtime: "desktop-session" } };
  assert.equal(await h.dispatch(entry, forged), "classify:task-reply");
  assert.equal(h.calls.launch.length, 0);
});
