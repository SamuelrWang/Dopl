// THE ORCHESTRATOR LAUNCH LANE (main/launch-directives.js + main/launch-directive-wire.js) —
// 2026-08-22, Samuel's launch-over-MCP ruling.
//
// THE FIVE PROPERTIES THIS FILE EXISTS FOR. This is the only path by which anything other than a
// human click starts a session on this Mac, so each of them is the difference between a feature
// and an escalation:
//
//   1. OFF MEANS OFF, AND SILENTLY. The local toggle defaults FALSE. With it off nothing is
//      claimed, nothing is launched and NOTHING IS WRITTEN — the row expires server-side, which
//      the orchestrator sees. A machine that has opted out does not report on itself.
//   2. NOT MINE MEANS NOTHING HAPPENS. The realtime filter is workspace-wide, so a colleague's
//      directive reaches this client. RLS should stop it; the local owner check is the fence
//      that does not depend on a policy this desktop neither owns nor evaluates.
//   3. THE DIRECTIVE CANNOT WIDEN CONTAINMENT. It supplies a GOAL, a MODEL and WHICH TEMPLATE.
//      The tool profile comes from main's own watched-channel DTO and the permission axes from
//      the operator's own durable posture — the same two sources the Launch button reads. This is
//      the case that matters most and it is asserted field by field. ⚠ The TEMPLATE half of it
//      lives in `launch-directive-template.test.mjs`, which holds the same line: a template
//      widens PROMPT CONTENT only.
//   4. A DIRECTIVE IS ACTIONED ONCE. Server CAS first, local dedupe behind it, because a
//      realtime frame and the backstop poll can deliver the same row a millisecond apart and the
//      claim is a network round-trip wide.
//   5. EXACTLY ONE DECISION, ALWAYS. `launched` + an address, or `refused` + one of the seven
//      words. A claimed directive nobody wrote back about is the one outcome an orchestrator
//      cannot act on.
//
// ⚠ TWO SIBLINGS, AND THE BOOT MACHINERY IS SHARED RATHER THAN COPIED
// (`_launch-directive-harness.mjs` — read its header for the split's seam):
//
//   `launch-directive-template.test.mjs`  the TEMPLATE lane this file's §4 leaves out — the
//                                         resolve at claim time, its failure table, the E-4
//                                         deletion signal, the model chain's new link.
//   `launch-directive-wire.test.mjs`      the CONTRACT — the shapes and route paths that cross
//                                         to the server lane, each pinned against that lane's
//                                         own source. Read it for the F-273 history.
//
// Both were split at the 500-line cap, and the subjects change on different clocks: this one when
// this machine's behaviour moves, the wire one when a schema or a route does, the template one
// when agent templates do.
//
// Run: `node --test dopl-desktop-app/test/launch-directives.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  boot, claimPosts, decidePosts, row, wire, launchOp,
  MAIN, SRC, WS, CH, TH, ME, OTHER, DID,
} from "./_launch-directive-harness.mjs";

// ── 2. OFF MEANS OFF, AND SILENTLY ───────────────────────────────────────────────────────

test("TOGGLE: with the lane off, a directive is ignored — no claim, no launch, NO WRITE", async () => {
  const h = boot({ enabled: false });
  await h.api.handle(row(), WS);
  assert.deepEqual(h.posts, [], "nothing was sent to the server at all");
  assert.equal(h.cfg.lastSpec, undefined, "and nothing was launched");
});

// ⚠ THE SILENCE IS THE DESIGN, NOT AN OVERSIGHT. A refusal from a machine that has not opted in
// is an admission that the machine is listening; letting the row EXPIRE tells the orchestrator
// the same thing without this machine reporting on itself.
test("TOGGLE: off does not even write a refusal — the row is left to expire", async () => {
  const h = boot({ enabled: false });
  await h.api.handle(row(), WS);
  assert.deepEqual(decidePosts(h), []);
});

// ── ⚠ THE BINDING IS NO LONGER THE TOGGLE, AND THAT IS THE 2026-09-01 CHANGE ─────────────
//
// It WAS `armed && enabled()`, and while the mailbox carried one verb those were the same
// condition. The mailbox carries three now and two of them — `end` and `rename` — need no
// consent (`directive-agent-ops.js`'s header carries the argument). A machine that bound nothing
// with the launch toggle off would make those two reachable ONLY on machines that had granted
// the consent they do not need, which is the exact inversion the ruling removes.
//
// ⚠ WHAT WIDENED IS A **READ**, AND ONLY OF THIS OPERATOR'S OWN ROWS: one more `postgres_changes`
// binding on a subscription this process already holds, over rows whose RLS SELECT is
// `operator_user_id = auth.uid()`. WHAT DID NOT WIDEN IS ANYTHING THIS MACHINE **DOES** — the two
// cases above still pass unchanged: with the toggle off a LAUNCH is claimed by nobody, decided by
// nobody and spawns nothing. Those are the cases that carry the §6 argument, and they are why
// this one can be flipped without weakening it.
test("TOGGLE: off still BINDS — the two consent-free kinds have to be seen (2026-09-01)", () => {
  const h = boot({ enabled: false });
  assert.deepEqual(h.arms, [{ on: true, handler: "function" }]);
});

test("TOGGLE: `refresh` re-arms and the binding tracks ARMED, not the toggle", () => {
  const h = boot({ enabled: true });
  assert.deepEqual(h.arms[0], { on: true, handler: "function" });
  h.cfg.enabled = false;
  h.api.refresh();
  // ⚠ STILL BOUND. The flip changes what this machine will ACT on, never what it can SEE.
  assert.deepEqual(h.arms[h.arms.length - 1], { on: true, handler: "function" });
  // …and the §6 half is unchanged: a launch arriving now is still claimed by nobody.
  const before = claimPosts(h).length;
  return h.api.handle(row(), WS).then(() => {
    assert.equal(claimPosts(h).length, before, "the toggle still gates every LAUNCH");
  });
});

// ⚠ READ AT DECISION TIME, NEVER CACHED. The operator may turn the lane off while a directive is
// in flight, and the next one must see that immediately rather than at the next restart.
test("TOGGLE: turning it off mid-run stops the very next directive", async () => {
  const h = boot({ enabled: true });
  await h.api.handle(row(), WS);
  assert.equal(claimPosts(h).length, 1);
  h.cfg.enabled = false;
  await h.api.handle(row({ id: OTHER.replace(/5/g, "7") }), WS);
  assert.equal(claimPosts(h).length, 1, "no second claim");
});

// ── 3. NOT MINE, AND NOT PENDING ─────────────────────────────────────────────────────────
//
// ⚠ THE REALTIME FILTER IS `workspace_id=eq.<id>` — WORKSPACE-WIDE. RLS makes the SELECT
// owner-only, but that is a policy on a table this desktop does not own, evaluated by a service
// it does not run, and the frame filter does not encode the operator at all. This check is the
// fence that does not depend on any of that.
test("OWNER: a colleague's directive in my workspace is ignored, silently", async () => {
  const h = boot();
  await h.api.handle(row({ operator_user_id: OTHER }), WS);
  assert.deepEqual(h.posts, []);
});

test("OWNER: a signed-out machine claims nothing — no identity is not a wildcard", async () => {
  const h = boot({ user: null });
  await h.api.handle(row(), WS);
  assert.deepEqual(h.posts, []);
});

test("STATUS: only a PENDING row is actioned — claimed / launched / expired are somebody's answer", async () => {
  for (const status of ["claimed", "launched", "refused", "expired", "", "bogus"]) {
    const h = boot();
    await h.api.handle(row({ status }), WS);
    assert.deepEqual(h.posts, [], status);
  }
});

// ── 4. THE LAUNCH — WHAT THE DIRECTIVE MAY AND MAY NOT SUPPLY ────────────────────────────
//
// ⚠ THE CASE THAT MATTERS MOST IN THIS FILE. A spawned session runs with `Bash` under a `bypass`
// posture and this operator's device token is on disk (§6). If a directive could name its own
// tool profile or permission axes, an orchestrator could grant itself more than the operator
// ever agreed to. It names a GOAL and a MODEL.
test("CONTAINMENT: the profile comes from MAIN's watched-channel DTO, not the directive", async () => {
  const h = boot({ watched: { id: CH, name: "General", toolProfile: "dopl_only" } });
  await h.api.handle(row({ tool_profile: "full", profile: "full" }), WS);
  assert.equal(h.cfg.lastSpec.toolProfile, "dopl_only", "main's own read wins");
});

test("CONTAINMENT: the permission axes are the operator's DURABLE posture, not the directive's", async () => {
  const h = boot();
  await h.api.handle(row({ start_modes: { tools: "bypass", messages: "auto_both" }, tools: "bypass" }), WS);
  assert.deepEqual(h.cfg.lastSpec.startModes, { tools: "bypass", messages: "auto_both" },
    "…which is what `channel-prefs.launchStartModes` answered, from local storage");
});

// ⚠ NOT WATCHING THE CHANNEL IS A REFUSAL, AND `no-bridge` IS THE HONEST WORD. Without this a
// directive naming an arbitrary channel id would reach a spawn with a fail-closed `read_only`
// profile and look like it worked.
test("CONTAINMENT: an unwatched channel is refused, and nothing is launched", async () => {
  const h = boot({ watched: null });
  await h.api.handle(row(), WS);
  assert.equal(h.cfg.lastSpec, undefined);
  assert.equal(decidePosts(h)[0].body.refusalReason, "no-bridge");
});

test("LAUNCH: it is windowless, operator-armed, and RUNS when a goal was sent", async () => {
  // ⚠ **`idle` IS NOW CONDITIONAL, AND THE DEFAULT FIXTURE CARRIES A GOAL** (2026-08-31, Samuel's
  // ruling). An operator-approved directive that names work RUNS it as the session's first turn;
  // the goal-less case below keeps ruling 3's stand-by shell. The two lanes and the two goal
  // states are pinned together in `test/launch-goal-delivery.test.mjs`.
  const h = boot();
  await h.api.handle(row(), WS);
  const spec = h.cfg.lastSpec;
  assert.equal(spec.idle, false, "a goal was sent, so no wake is needed for it to start");
  assert.equal(spec.windowless, true);
  // ⚠ `operatorArmed` IS WHAT LETS THE DURABLE POSTURE REACH AN IDLE SPAWN (`session-engine.js`'s
  // FIX-4 guard). The TOGGLE is the human here — Samuel's ruling replaces the click with it on
  // this lane. Without it the spawn silently drops the operator's own posture.
  assert.equal(spec.operatorArmed, true);
});

// ⚠ THE GOAL MUST ACTUALLY REACH THE AGENT, ON EITHER SHAPE. A RUNNING spawn's goal is built
// into `firstTurn` by `startSession`; a spawn-idle shell's rides as `firstMessage` ->
// `s.launchGoal` -> `session-seed.js › takeFraming`, which fences it as the WAKE turn's request
// body (the 1.17.1 plumbing, which the 2026-08-31 ruling narrows to the no-goal case rather than
// deleting). Both ends are driven in `test/launch-goal-delivery.test.mjs`.
test("LAUNCH: the directive's goal is handed in as the requester goal, and lands in launchGoal", async () => {
  const h = boot();
  await h.api.handle(row({ goal: "Draft the release notes" }), WS);
  assert.equal(h.cfg.lastSpec.goal, "Draft the release notes");
  // The plumbing on the far side, pinned as source so a rename there fails here rather than
  // silently leaving directive-launched agents with an empty fence.
  const engine = readFileSync(join(MAIN, "session-engine.js"), "utf8");
  assert.match(engine, /launchGoal: spec\.parkedShell === true \? String\(spec\.firstMessage/);
  const launch = readFileSync(join(MAIN, "session-launch.js"), "utf8");
  assert.match(launch, /launchRequesterSession\(a\) \{\s*return launch\(\{ \.\.\.a, side: 'requester', firstMessage: a\.goal \}\);/);
});

test("LAUNCH: a goal-less directive falls back to the button's own sentence", async () => {
  const h = boot();
  await h.api.handle(row({ goal: "" }), WS);
  assert.match(h.cfg.lastSpec.goal, /Join this thread as my agent/);
  assert.equal(h.cfg.lastSpec.idle, true, "…and a synthesized sentence does NOT buy a `claude` child");
  const ch = boot();
  await ch.api.handle(row({ goal: "", task_id: null }), WS);
  assert.match(ch.cfg.lastSpec.goal, /Stand by in this channel/);
  assert.equal(ch.cfg.lastSpec.idle, true);
});

// ⚠ THE MODEL GOES THROUGH THE FROZEN LIST, so an unknown id from an orchestrator on a newer
// build cannot reach argv — and cannot refuse the launch either.
test("MODEL: a known id becomes its argv-safe alias", async () => {
  const ok = boot();
  await ok.api.handle(row({ model: "claude-opus-5" }), WS);
  assert.equal(ok.cfg.lastSpec.model, "opus");
  assert.equal(ok.cfg.lastSpec.idle, false, "the fixture carries a goal — see the ruling above");
});

// ⚠ **F-285 — AN ALIAS IS A LEGITIMATE VALUE ON THIS LANE, AND IT USED TO BE THROWN AWAY.**
// `channel-schema.ts › model` is an unconstrained string that names no vocabulary, and the
// bundled CLI documents `--model` as an alias (`opus`/`sonnet`/`fable`) OR a full name — so an
// orchestrator writing `opus` is doing the ordinary thing. The old ternary coerced through
// `aliasForModelId`, which knows FULL IDS ONLY, so `opus` became `'default'`, the ternary was
// already committed, and BOTH lower links were skipped: the operator got the SDK default on a
// channel they had configured. `chainModel` accepts both vocabularies.
test("MODEL: a bare ALIAS is honoured, not collapsed to the SDK default (F-285)", async () => {
  for (const alias of ["opus", "sonnet", "haiku", "fable"]) {
    const h = boot();
    await h.api.handle(row({ model: alias }), WS);
    assert.equal(h.cfg.lastSpec.model, alias, `directive model '${alias}'`);
  }
});

// ⚠ AND AN UNRECOGNISED ID FALLS THROUGH RATHER THAN ENDING THE CHAIN — which is what
// `channel-schema.ts › model` promises the orchestrator in so many words ("it silently FALLS BACK
// to whatever the channel is set to") and what INVARIANTS §10's `launch_agent` bullet records.
// Before F-285 it ended the chain at `'default'`, so the doc and the code disagreed.
test("MODEL: an id this build does not know FALLS BACK to the channel's pick (F-285)", async () => {
  const bad = boot();
  await bad.api.handle(row({ model: "claude-from-the-future-9" }), WS);
  assert.equal(bad.cfg.lastSpec.model, "sonnet", "the channel's stored pick, not the SDK default");
  assert.equal(bad.cfg.lastSpec.idle, false, "…and the launch still happens (F-5: never refuse)");
});

// ⚠ THE TEMPLATE'S LINK SITS BETWEEN THEM, and an unknown DIRECTIVE model must not step over it.
test("MODEL: an unknown directive model falls to the TEMPLATE's before the channel's", async () => {
  const h = boot({ resolve: { ok: true, template: { name: "Code Auditor", model: "claude-haiku-4-5-20251001" } } });
  const TPL = "77777777-7777-4777-8777-777777777777";
  await h.api.handle(row({ model: "claude-from-the-future-9", template_id: TPL }), WS);
  assert.equal(h.cfg.lastSpec.model, "haiku");
});

test("MODEL: an ABSENT model falls back to the CHANNEL's own stored pick", async () => {
  const h = boot();
  await h.api.handle(row({ model: "" }), WS);
  assert.equal(h.cfg.lastSpec.model, "sonnet", "what the button would have used");
});

// ── 5. THE CLAIM, AND ACTIONING A DIRECTIVE EXACTLY ONCE ─────────────────────────────────

test("CLAIM: losing the race is a NORMAL no-op — no launch, and no decision either", async () => {
  const h = boot({ claimAnswer: { ok: true, status: 200, json: { ok: false, reason: "claimed" } } });
  await h.api.handle(row(), WS);
  assert.equal(h.cfg.lastSpec, undefined, "another machine won");
  assert.deepEqual(decidePosts(h), [], "…and the winner writes the decision, not us");
});

// ⚠ THE FAILURE DIRECTION IS THE SAFE ONE: whatever went wrong, this machine does nothing.
test("CLAIM: a 404 or a network failure launches nothing and writes nothing", async () => {
  for (const answer of [{ ok: false, status: 404 }, { throws: "ECONNREFUSED" }]) {
    const h = boot({ claimAnswer: answer });
    await h.api.handle(row(), WS);
    assert.equal(h.cfg.lastSpec, undefined);
    assert.deepEqual(decidePosts(h), []);
  }
});

// ⚠ **F-286 — LOSING THE CAS IS THE DESIGNED OUTCOME FOR EVERY MACHINE BUT ONE, AND THE LOG LINE
// HAS TO SAY SO.** `service-launch.ts › claimLaunchDirective` THROWS
// `LaunchDirectiveNotClaimableError` when the CAS matches no row, which `http-mapping.ts` maps to
// 409 — so an operator running four desktops got an error-shaped line, once per directive per
// machine, asserting "the row stays pending and expires" when the row was CLAIMED and another
// machine was already launching it. The module's own dedicated "a normal no-op" branch was
// unreachable against the real route, which answers 200 or throws and never `{ok:false}`.
test("CLAIM: a 409 is logged as a NORMAL no-op, not as a failure (F-286)", async () => {
  for (const status of [409, 404]) {
    const h = boot({ claimAnswer: { ok: false, status } });
    await h.api.handle(row(), WS);
    const lines = h.logged.filter((l) => l.includes("launch-directive"));
    assert.ok(lines.some((l) => l.includes("claim lost") && l.includes("a normal no-op")),
      `HTTP ${status} must read as a no-op: ${JSON.stringify(lines)}`);
    assert.equal(lines.some((l) => l.includes("the row stays pending")), false,
      `HTTP ${status} does NOT leave the row pending — it is claimed, decided or gone`);
    assert.equal(h.cfg.lastSpec, undefined, "…and this machine still stands down");
    assert.deepEqual(decidePosts(h), []);
  }
  // ⚠ AND A GENUINE FAULT KEEPS THE OLD WORDING — a 5xx or a dead socket really does leave the
  // row pending, and that line is the one that should look like a problem.
  for (const answer of [{ ok: false, status: 503 }, { throws: "ECONNREFUSED" }]) {
    const h = boot({ claimAnswer: answer });
    await h.api.handle(row(), WS);
    assert.ok(h.logged.some((l) => l.includes("claim failed") && l.includes("stays pending")),
      JSON.stringify(h.logged));
  }
});

test("CLAIM: the launch is driven by the CLAIMED row, not by the realtime frame", async () => {
  // ⚠ THE FRAME IS A PROMPT, THE CLAIM IS THE PERMIT. If the two disagree the authenticated one
  // wins — a frame is unauthenticated data that merely arrived first.
  const h = boot({ claimed: row({ status: "claimed", goal: "THE REAL GOAL", model: "claude-haiku-4-5-20251001" }) });
  await h.api.handle(row({ goal: "the frame's goal", model: "claude-opus-5" }), WS);
  assert.equal(h.cfg.lastSpec.goal, "THE REAL GOAL");
  assert.equal(h.cfg.lastSpec.model, "haiku");
});

test("ONCE: the same row delivered twice is claimed once", async () => {
  const h = boot();
  await Promise.all([h.api.handle(row(), WS), h.api.handle(row(), WS)]);
  await h.api.handle(row(), WS);
  assert.equal(claimPosts(h).length, 1, "the in-flight guard, then the decided ledger");
  assert.equal(decidePosts(h).length, 1);
});

test("ONCE: the ledger is BOUNDED, so a long-running machine cannot leak one entry per row", () => {
  const h = boot();
  assert.equal(typeof h.api.MAX_REMEMBERED, "number");
  assert.ok(h.api.MAX_REMEMBERED > 0 && h.api.MAX_REMEMBERED <= 1024);
  assert.match(SRC, /decided\.delete\(decided\.values\(\)\.next\(\)\.value\)/,
    "oldest evicted first, the `MAX_NOTIFIED_DENIALS` idiom");
});

// ── 6. THE DECISION — EXACTLY ONE, ALWAYS ────────────────────────────────────────────────

test("DECIDE: a successful launch writes `launched` and the AGENT ID", async () => {
  const h = boot();
  await h.api.handle(row(), WS);
  // ⚠ THE ECHO TRIO JOINED THIS BODY ON 2026-09-01 (T24's second half, F-410) — what the machine
  // says it APPLIED, after its clamp. It is asserted whole here rather than key by key because
  // this case is the shape of the decide; `launch-directive-echo.test.mjs` is where the echo's own
  // rules live (clamped-not-requested, `false` is a report, a refusal carries none).
  assert.deepEqual(decidePosts(h)[0].body, {
    directiveId: DID, status: "launched", agentId: "a1b2c3d4",
    appliedTools: "bypass", appliedMessages: "auto_both", appliedChain: false,
  });
  assert.equal(decidePosts(h)[0].workspaceId, WS, "fenced on the workspace, like every write here");
});

test("DECIDE: every refusal `launch()` can produce arrives as its own word", async () => {
  for (const skipped of ["cap", "busy", "no-sdk", "auth-hold"]) {
    const h = boot({ launch: async () => ({ skipped }) });
    await h.api.handle(row(), WS);
    assert.equal(decidePosts(h)[0].body.status, "refused");
    assert.equal(decidePosts(h)[0].body.refusalReason, skipped);
  }
});

test("DECIDE: `disabled` — the shape with no member of its own — arrives as `no-bridge`", async () => {
  const h = boot({ launch: async () => ({ skipped: "disabled" }) });
  await h.api.handle(row(), WS);
  assert.equal(decidePosts(h)[0].body.refusalReason, "no-bridge");
});

// ⚠ THE CRASH-SAFETY CHOICE, ASSERTED. A throw mid-spawn leaves NO decision, deliberately: this
// process cannot tell whether an agent was created, so `refused` would be a claim it cannot
// support and `launched` would name an agent that may not exist. An expiry is the only honest
// terminal state for an outcome nobody observed — and the orchestrator already handles expiry,
// because that is what the toggle-off path produces.
test("CRASH: a throw inside the spawn writes NO decision, and does not take the process down", async () => {
  const h = boot({ launch: async () => { throw new Error("boom"); } });
  await h.api.handle(row(), WS);
  assert.deepEqual(decidePosts(h), [], "left to lazy-expire, which is the stated choice");
  assert.equal(claimPosts(h).length, 1);
});

test("CRASH: there is no restart sweep, and that is the documented decision, not an omission", () => {
  assert.match(SRC, /CRASH SAFETY — A CLAIMED-BUT-UNDECIDED DIRECTIVE IS LEFT TO LAZY-EXPIRE/);
  assert.equal(/function sweep\(/.test(SRC), false);
});

// ── 7. THE BACKSTOP ──────────────────────────────────────────────────────────────────────
//
// ⚠ IT IS FOR THE BREAKER, NOT FOR CORRECTNESS. `realtime.js`'s breaker holds a LONG cooldown by
// design, and a directive is a request somebody is waiting on — without this, arming the lane
// and then flapping the WS would leave an orchestrator waiting out the whole expiry window.
test("BACKSTOP: a healthy workspace is never polled — push already delivers those", async () => {
  const h = boot({ healthy: true });
  await h.api.handle(row(), WS); // prove the module is live
  // ⚠ **THE CLAIM IS ABOUT THE *POLL*, NOT ABOUT EVERY GET THIS LANE MAKES**, and it was written
  // as `h.gets.length === 0` while the poll was the only read there was. A SPAWN now reads the
  // pinned startup context too (2026-09-01, T81), on a different route and for a different
  // reason, so counting all GETs would fail on an unrelated feature and — worse — would have gone
  // green if the poll moved to a path this file does not name. Filtered on the backstop's own route.
  const polls = h.gets.filter((g) => g.path === wire.ROUTES.pending);
  // The interval is 60s and `unref`'d; the behaviour is driven directly.
  assert.equal(polls.length, 0, "no backstop GET while push is up");
  assert.equal(h.api.POLL_MS, 60000);
});

test("BACKSTOP: the poll runs the SAME funnel, so every guard above still applies to it", () => {
  // ⚠ ASSERTED AS SOURCE because a second entry point that skipped `handle` would bypass the
  // toggle, the owner check and the dedupe in one edit — the exact shape of a lane that is safe
  // through the door everyone reads and open through the one nobody does.
  assert.match(SRC, /for \(const row of rows\) await handle\(row, wsId\);/);
  assert.match(SRC, /if \(realtime\.isWorkspaceHealthy\(wsId\)\) continue;/);
  assert.match(SRC, /function deliver\(workspaceId, row\) \{\s*void handle\(row, workspaceId\);/);
});

// ── 8. THE TRANSPORT ─────────────────────────────────────────────────────────────────────

test("TRANSPORT: it rides api.js, and does not grow a third main-process fetch copy", () => {
  // `api.js` carries the shared 401 repair (`api-repair.js`); a second copy of that repair is
  // what produced the 1.8.x Channels outage.
  assert.match(SRC, /require\('\.\/api'\)/);
  assert.equal(/\bfetch\(/.test(SRC), false);
  assert.match(SRC, /workspaceId/, "every call is fenced on the workspace");
});
