// `targeting.requesterTaskOpen` — WHOSE THREAD OPENER THIS MACHINE WOULD DRIVE.
//
// ⚠ THIS FILE IS NOW A PURE PREDICATE TABLE (2026-08-20, F-228). It was written as the
// RED/GREEN for "the operator's own typed request starts the agent" (2026-08-05, rollback plan
// §3.4), and the half of it that drove the listener is deleted with route (2) — see the two
// excision blocks at the foot. The PREDICATE is untouched: `main/targeting.js` was not
// modified by the retirement, so `requesterTaskOpen`, `declaresHandoff`, `DESKTOP_RUNTIMES`
// and `requesterTypedByOperator` are all still live functions with live truth tables, and
// INVARIANTS §14 says a mixed file whose feature is deleted is rewritten down to what
// survives, not removed.
//
// ⚠ AND IT STILL ANSWERS A QUESTION WORTH ASKING, even with no route reading it. The runtime
// STAMP is the wire's only evidence of which machine originated a create, it is server-written
// and unforgeable, and the identity conjuncts around it are the wrong-machine guard. Whatever
// reads that answer next — and something will, or the predicate is dead tissue and should be
// deleted rather than left half-tested — inherits this table.
//
// WHAT THE PREDICATE SAYS, AND WHY IT COULD. Three sender-side outcomes used to exist for one
// action:
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
// there is simply a second one now, and BOTH desktop runtimes answer true.
//
// METHOD: the repo's source-extraction idiom, minus the extraction. targeting.js is
// dependency-free, so the REAL predicate is required and driven directly; the source reads
// that remain are the dead-tissue pins, which have to look at text rather than behaviour.

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

const require = createRequire(import.meta.url);
const targeting = require("../main/targeting.js"); // dependency-free; the REAL predicates

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
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

test("GREEN: the operator's typed request satisfies the requester predicate", () => {
  // ⚠ RETITLED (2026-08-20). It read "…opens a full requester session", which was a claim
  // about route (2) and is no longer true of anything: nothing opens. The predicate's own
  // answer is unchanged and is what this file measures.
  assert.equal(opens(typed()), true);
});

test("the shell predicate is GONE, not merely unused", () => {
  // Deleting the route while leaving the predicate exported is the dead tissue the 2026-08-05
  // change set out not to leave behind. ⚠ STILL A LIVE PIN: every file it names still exists,
  // and the same rule is what the session-dispatch export census now applies to route (2).
  assert.equal(targeting.requesterShellOpen, undefined, "requesterShellOpen must not exist");
  assert.ok(!TARGETING.includes("requesterShellOpen"), "and no trace of it in the source");
  assert.ok(!DISPATCH.includes("maybeOpenRequesterShell"), "nor its route");
  assert.ok(!LISTENER.includes("maybeOpenRequesterShell"), "nor its listener call");
  assert.ok(!M("session-park.js").includes("async function openRequesterShell"),
    "nor its park entry point");
});

test("BOTH desktop runtimes answer true; nothing else does", () => {
  assert.deepEqual(targeting.DESKTOP_RUNTIMES, ["desktop-session", "desktop-ui"],
    "the two stamps this app produces, and only those two");
  assert.equal(opens(typed({ runtime: "desktop-session" })), true, "a spawned session, unchanged");
  assert.equal(opens(typed({ runtime: "desktop-ui" })), true, "and the operator's own typing");
  // Padding is trimmed by metaStr, so a padded stamp is still the same runtime on both sides.
  assert.equal(opens(typed({ runtime: "  desktop-ui  " })), true);
});

test("CASE 3 — an EXTERNAL, UNSTAMPED create still answers NOTHING", () => {
  // The operator's own external Claude Code session sends no runtime header and awaits the
  // reply itself. Absent key, empty string, whitespace and a missing metadata bag all refuse.
  const noKey = typed();
  delete noKey.metadata.runtime;
  assert.equal(opens(noKey), false, "no stamp, no window");
  assert.equal(opens(typed({ runtime: "" })), false);
  assert.equal(opens(typed({ runtime: "   " })), false);
  assert.equal(opens({ ...typed(), metadata: undefined }), false);
  // ...and the author kind rescues nothing in either direction: what refuses here is the
  // STAMP, so an unstamped create answers false whether a person or an agent claims it.
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
  // It decided ONE display-only thing (arming the request strip). `desktop-session` is not the
  // operator typing, and an unstamped post is not either.
  // ⚠ THE ONE THING IT GATED IS GONE (2026-08-20, F-228): the request STRIP lived in the
  // session-window chrome. The predicate is untouched and still exported, and "gates nothing on
  // its own" — always the point of this test — is now literally true rather than a caution.
  assert.equal(targeting.requesterTypedByOperator(typed()), true);
  assert.equal(targeting.requesterTypedByOperator(typed({ runtime: "desktop-session" })), false);
  assert.equal(targeting.requesterTypedByOperator(typed({ runtime: "" })), false);
  assert.equal(targeting.requesterTypedByOperator({ metadata: undefined }), false);
});

// ⚠ SECTIONS 2, 3 AND 4 STOOD BELOW AND ARE GONE (2026-08-20, F-228) — the listener's order,
// the behavioural mirror that drove route (2), and its diag block. Fourteen tests.
//
// §2 THE LISTENER'S ORDER — two tests. "three pre-classify routes, and classify still runs
//   LAST" pinned the indexOf sequence `noteRequestLifecycle` < `feedLiveSession` <
//   `maybeOpenRequesterSession` < `maybeSurfaceRequesterReply` < `classify`; "the strip
//   observation is a statement, not a route" pinned that `noteRequestLifecycle` never gained an
//   `if (…) return;`, because the events it read belonged to other routes and swallowing a
//   peer's reply there would lose the message the operator was waiting for. Four of the five
//   sites are deleted. ⚠ THE SURVIVING HALF — feedLiveSession before classify, and classify
//   LAST — is pinned in test/wake-external-requester.test.mjs, which is where the mirror it
//   guarded lives.
//
// §3 THE MIRROR — seven tests, all driving `maybeOpenRequesterSession`: "GREEN: a typed request
//   LAUNCHES the agent, with the peer bound and the thread named" (the full launch spec —
//   goal, counterpartyId for FIX L1, `direct`, and the context prompt-framing reads), "a
//   DESKTOP-SPAWNED create takes the IDENTICAL launch, and arms no strip", "CASE 3 — an
//   EXTERNAL, UNSTAMPED create reaches NO route and starts nothing", "HANDOFF dispatch",
//   "one session per thread", "window-mode OFF opens nothing", "a refused launch falls through
//   to today's behaviour". The route minted a REQUESTER WINDOW on the operator's OWN thread
//   opener and launched their agent against their own message — the self-trigger bug the
//   retirement was ruled from. ⚠ CASE 3's residue is a classify fact, not a route fact ("my own
//   create classifies 'ignore'"), and it is driven end-to-end in
//   test/wake-external-requester.test.mjs; nothing here was its only reader.
//
// §4 THE DIAG — two tests over `diagRuntimeGateSkip`, a helper of route (2): an unstamped
//   create named the stamp it saw and leaked no body, title or full member id. The helper is
//   deleted; the leak rule it enforced has no call site left to break.
//
// ⚠ AND SECTION 5, THE LIFECYCLE STRIP — six tests over `noteRequestLifecycle` (route 4): the
// peer's task_started -> Accepted, a `declined: true` task_failed -> Declined and a flagless
// one holding, the first reply -> Replied WITHOUT being swallowed, the pair binding (a third
// member, somebody else's thread, my own milestone and a legacy id all move nothing), the
// inherited-key guard on `REQUEST_MILESTONES` (`constructor` is not a milestone), and the
// transition diag. The strip was a status line in the session-window CHROME; there is no
// chrome, no `REQUEST_MILESTONES` and no `armRequestStatus` / `noteRequestStatus` on the
// engine or on session-park. ⚠ The one rule with an independent life — "an observation must
// not swallow the message it observes" — is not orphaned: it is the shape of the whole
// dispatcher, and `feedLiveSession` is the only claimant left, pinned positively and
// negatively in test/session-dispatch.test.mjs.
