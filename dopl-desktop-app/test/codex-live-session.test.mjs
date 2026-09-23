// THE LIVE SESSION CONTRACT — U3's three unprovable claims, against a real `codex app-server`.
//
// 🔒 ⚠ **EVERYTHING IN THIS FILE IS TIER 2. IT MEASURES CODEX, NOT DOPL**, and it is the only
// place in the tree allowed to say what a steer, an interrupt or a resume DOES. U3's test
// scenarios name three things a fixture can never answer — "steer targets the current turn and is
// rejected after that turn completes", "interrupt targets the active turn and Dopl receives a
// terminal interrupted state", and the resume-usage question (does a resume carry the usage baseline) — and each
// one needs a turn that a real model actually runs.
//
// ⚠ **THE SKIP IS LOUD, THE `_codex-app-server.mjs` WAY.** Banner at import, `t.diagnostic` +
// `t.skip` per case, and `npm run test:codex-compat` refuses to report success when the tier did
// not arm. A skipped tier that reads as a passing one is the exact failure the plan was written
// about; nothing here may be mistaken for a measurement that did not happen.
//
// 💰 ⚠ **THESE SPEND THE OPERATOR'S OPENAI QUOTA — THREE MODEL TURNS PER RUN WITH `CODEX_LIVE_TURN=1`**, and that is
// the budget: one interrupted turn (steer + interrupt + stale steer), and two trivial turns for
// the resume measurement, which needs a turn on each side of the resume by construction. Every
// prompt is a word-length reply or a countdown that is cut short. **Do not add a turn here
// without deleting one**, and never a turn that writes a file or runs a command — the sandbox is
// `read-only` and the policy is `never` on every thread below, so nothing can.
//
//   ordinary unit run   npm test                                (skips, loudly)
//   armed, no turns     CODEX_APP_SERVER_LIVE=1 npm test
//   armed, with turns   CODEX_APP_SERVER_LIVE=1 CODEX_LIVE_TURN=1 npm test
//   the release gate    npm run test:codex-compat               (sets both)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  client, liveGate, announceGate, skipLive, skipTurn,
  withAppServer, appEnv, terminateConn, leakedPids, RUNTIME_DESCRIPTOR,
  LIVE_THREAD, LIVE_TURN,
} from './_codex-app-server.mjs';

const GATE = announceGate(liveGate());
const require = createRequire(import.meta.url);
const launchSpec = require('../main/runtime/codex/launch-spec.js');
const normalize = require('../main/runtime/codex/normalize.js');

// ⚠ A FRESH DIRECTORY PER RUN, NEVER THE REPO. `cwd` is the thread's captured working directory
// and `thread/list` filters by it; pointing a live turn at this checkout would put the tree in a
// real model's context for no measurement gain.
const WORKDIR = mkdtempSync(join(tmpdir(), 'dopl-codex-live-'));

// The narrowest thread a turn can run in: no approvals can be raised, nothing can be written.
const SAFE_THREAD = Object.freeze({ approvalPolicy: 'never', sandbox: 'read-only' });
const TRIVIAL = [{ type: 'text', text: 'reply with the word ok' }];
const TURN_BUDGET_MS = 150000;

/**
 * One live app-server, with the notifications a session cares about collected.
 *
 * ⚠ It goes through `client.connect` and `appEnv()` — the module and the environment the app
 * itself spawns with — so what is measured is the child a launch would produce.
 *
 * 🔒 ⚠ **TEARDOWN IS AN `after` HOOK, NOT A `finally`, AND THAT IS NOT A STYLE CHOICE.** node:test
 * does not cancel the body of a test that exceeds its `timeout` — it marks it failed and moves on
 * while the async function stays parked on whatever it was awaiting. A `finally` therefore never
 * runs, the child is never killed, and the worker cannot exit: one timed-out case here left an
 * orphan `codex app-server` that outlived the whole suite and hung a concurrent release run.
 * `t.after` runs on the timeout path too, so every child this file starts dies with its test.
 */
function openSession(t, record) {
  const conn = client.connect({
    args: [],
    env: appEnv(),
    cwd: WORKDIR,
    log: () => {},
    onNotification: (msg) => record(msg),
    // ⚠ NOTHING HERE MAY ANSWER AN APPROVAL. `approvalPolicy: 'never'` means none is raised; if
    // one ever were, the protocol-valid refusal is the only honest answer a test can give.
    onServerRequest: async (msg) => {
      throw Object.assign(new Error(`unattended live test refuses ${msg.method}`), { rpcCode: -32601 });
    },
    onExit: () => {},
  });
  t.after(() => terminateConn(conn));
  return conn;
}

/** Poll a predicate to a deadline. ⚠ The FAILURE names what never arrived, not just "timeout". */
async function until(predicate, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) assert.fail(`waited ${ms}ms and never saw ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const turnFrames = (frames, method, turnId) => frames.filter(
  (f) => f.method === method && f.params.turn && f.params.turn.id === turnId,
);

// ══ STEER AND INTERRUPT — U3's two turn-targeting claims, in one turn ════════════════════════

describe('live: steer and interrupt target the ACTIVE turn, and only the active turn', () => {
  test('a steer lands on the current turn; an interrupt ends it; a later steer is refused', { timeout: TURN_BUDGET_MS }, async (t) => {
    if (skipLive(t, GATE) || skipTurn(t)) return;
    const frames = [];
    const conn = openSession(t, (m) => frames.push(m));
    {
      await conn.request('initialize', client.initializeParams('0.0.0-live'));
      const thread = await conn.request('thread/start', Object.assign({ cwd: WORKDIR }, SAFE_THREAD, LIVE_THREAD));
      const threadId = thread.thread.id;

      // A turn long enough to still be running when the steer and the interrupt arrive.
      const turn = await conn.request('turn/start', Object.assign({
        threadId, input: [{ type: 'text', text: 'count from 1 to 60, one number per line' }],
      }, LIVE_TURN));
      const turnId = turn.turn.id;
      await until(() => turnFrames(frames, 'turn/started', turnId).length, 60000, `turn/started for ${turnId}`);

      // ── THE STEER, MID-TURN. `expectedTurnId` is REQUIRED by the schema and it is the whole
      // mechanism: the server matches it against the turn that is actually running.
      const steered = await conn.request('turn/steer', {
        threadId, expectedTurnId: turnId, input: [{ type: 'text', text: 'stop at three' }],
      });
      assert.equal(
        steered.turnId, turnId,
        'a steer APPENDS to the running turn — it does not open a new one, which is what makes '
        + '`launch-spec.js`\'s "first push is a turn, every later one is a steer" pump correct',
      );

      // ── THE INTERRUPT, on the same live turn. `{ threadId, turnId }`, and the result is empty.
      const stopped = await conn.request('turn/interrupt', { threadId, turnId });
      assert.deepEqual(stopped, {}, 'turn/interrupt answers with an empty result, not a state object');

      // ── THE TERMINAL STATE DOPL RECEIVES. It is `turn/completed` — the same frame a successful
      // turn ends on — carrying `status: "interrupted"`. There is no separate `turn/interrupted`
      // notification, which is why `normalize.js` reaching one terminal `result` off
      // `turn/completed` is the correct shape and not a gap.
      await until(() => turnFrames(frames, 'turn/completed', turnId).length, 60000, `turn/completed for ${turnId}`);
      const completed = turnFrames(frames, 'turn/completed', turnId)[0];
      assert.equal(completed.params.turn.status, 'interrupted');
      assert.equal(completed.params.threadId, threadId, 'the terminal frame names its thread');

      // ── AND THE TURN IS GONE. A steer aimed at it is REFUSED, so a stale command cannot land on
      // whatever turn happens to be running next.
      await assert.rejects(
        conn.request('turn/steer', { threadId, expectedTurnId: turnId, input: TRIVIAL }),
        (err) => {
          assert.equal(err.code, -32600, 'a stale steer is an INVALID REQUEST, not a silent no-op');
          assert.match(String(err.message), /no active turn/i);
          return true;
        },
      );
      // 🔒 ⚠ **BUT A SECOND `turn/interrupt` ANSWERS NOTHING AT ALL — NOT A RESULT, NOT AN ERROR.**
      // This is the asymmetry that pays for `launch-spec.js › boundedInterrupt`. Steer rejects
      // cleanly in every dead-turn state, and an interrupt aimed at a turn that ended NORMALLY
      // rejects with the same `-32600`; only an interrupt aimed at an ALREADY-INTERRUPTED turn
      // just sits there. An unbounded `handle.interrupt()` would hand its caller a promise that
      // never settles, and `session-engine.js`'s `interruptQuery` is fire-and-forget only by
      // luck — the first caller that awaits it would hang for the life of the child.
      const second = conn.request('turn/interrupt', { threadId, turnId });
      const verdict = await Promise.race([
        second.then(() => 'resolved', (err) => `rejected:${err && err.code}`),
        new Promise((r) => { setTimeout(() => r('NEVER ANSWERED'), 5000).unref(); }),
      ]);
      assert.equal(
        verdict, 'NEVER ANSWERED',
        'if this CLI has started answering a repeat interrupt, DELETE `boundedInterrupt` — do not '
        + 'leave a bound standing for a hazard that is gone',
      );
      second.catch(() => {}); // the request stays outstanding until the child dies; do not warn
      // ⚠ AND THE ADAPTER'S OWN VERB IS BOUNDED, so the same call through Dopl always settles.
      await launchSpec.boundedInterrupt(conn.request('turn/interrupt', { threadId, turnId }));
    }
  });
});

// ══ THE RESUME MEASUREMENT — the plan's named open question (§5 item C8 / CXP-4) ═════════════

describe('live: usage accounting across thread/resume', () => {
  test('`thread/resume` CONTINUES the cumulative total, and the descriptor says so', { timeout: TURN_BUDGET_MS * 2 }, async (t) => {
    if (skipLive(t, GATE) || skipTurn(t)) return;

    // ⚠ TWO CHILDREN, DELIBERATELY. Resuming inside the process that started the thread would
    // measure a cache, not a resume; a parked Dopl session resumes in a NEW app-server.
    const usageFor = (frames, turnId) => frames
      .filter((f) => f.method === 'thread/tokenUsage/updated' && f.params.turnId === turnId)
      .map((f) => f.params.tokenUsage)
      .pop();

    // One trivial turn, awaited to its terminal frame. ⚠ THE TERMINAL STATUS IS ASSERTED: a turn
    // that FAILED (a rate limit, a refusal) also ends on `turn/completed` and reports no usage at
    // all, and "no tokenUsage" would otherwise read as a protocol finding rather than as the
    // account problem it is. The failure message carries the server's own reason.
    async function oneTurn(conn, frames, threadId) {
      const turn = await conn.request('turn/start', Object.assign({ threadId, input: TRIVIAL }, LIVE_TURN));
      const turnId = turn.turn.id;
      await until(
        () => frames.some((f) => f.method === 'turn/completed' && f.params.turn.id === turnId),
        120000, `turn ${turnId} to complete`,
      );
      const done = frames.filter((f) => f.method === 'turn/completed' && f.params.turn.id === turnId)[0];
      const failure = done.params.turn.error || {};
      // ⚠ **A QUOTA REFUSAL IS A MACHINE CONDITION, NOT A PROTOCOL FINDING** — but it still FAILS
      // rather than skipping. A release gate that reported success because the account was out of
      // credit would be the U1 failure exactly: green having measured nothing. So it goes red, and
      // the message says which of the two it is so nobody debugs the adapter over a bill.
      assert.notEqual(
        failure.codexErrorInfo, 'usageLimitExceeded',
        'THE LIVE TIER COULD NOT MEASURE — this OpenAI account is out of credit, which is not a '
        + `Dopl protocol failure. Codex said: ${failure.message}`,
      );
      assert.equal(
        done.params.turn.status, 'completed',
        `the turn did not complete: ${JSON.stringify(failure)}`,
      );
      return turnId;
    }

    // ── CHILD A: cold thread, one turn.
    const a = [];
    const connA = openSession(t, (m) => a.push(m));
    let threadId = null;
    let coldUsage = null;
    {
      await connA.request('initialize', client.initializeParams('0.0.0-live'));
      const thread = await connA.request('thread/start', Object.assign({ cwd: WORKDIR }, SAFE_THREAD, LIVE_THREAD));
      threadId = thread.thread.id;
      const turnId = await oneTurn(connA, a, threadId);
      coldUsage = usageFor(a, turnId);
      assert.ok(coldUsage, 'a completed turn reports thread/tokenUsage/updated');
      // On the FIRST turn of a thread, `last` and `total` are the same number by definition.
      assert.equal(coldUsage.total.totalTokens, coldUsage.last.totalTokens);
      assert.ok(coldUsage.total.totalTokens > 0);
    }

    // ── CHILD B: resume that thread, one more turn.
    const b = [];
    const connB = openSession(t, (m) => b.push(m));
    {
      await connB.request('initialize', client.initializeParams('0.0.0-live'));

      // 🔒 ⚠ **A THREAD HAS ONE WRITER, AND CHILD A STILL HOLDS IT** (MEASURED 2026-09-22). While
      // the app-server that started the thread is alive, `thread/resume` from a second one is
      // REFUSED — `-32600 "thread … already has an active writer"`. That is a real constraint on
      // Dopl's park/resume, not a test artefact: a resume path that rebuilds the session before
      // the previous child is reaped does not race, it FAILS, and the operator sees a refusal
      // whose text is about writers. Whatever eventually lifts the resume refusal (CXP-4) has to
      // reap first and resume second.
      await assert.rejects(
        connB.request('thread/resume', Object.assign({ threadId, cwd: WORKDIR }, SAFE_THREAD)),
        (err) => {
          assert.equal(err.code, -32600);
          assert.match(String(err.message), /active writer/i);
          return true;
        },
      );
      // So the prior child is REAPED first — which is exactly the order a park must use. (The
      // `t.after` hook still runs; terminating an already-dead child is a no-op.)
      await terminateConn(connA);

      const resumed = await connB.request(
        'thread/resume', Object.assign({ threadId, cwd: WORKDIR }, SAFE_THREAD, LIVE_THREAD),
      );
      assert.equal(resumed.thread.id, threadId, 'thread/resume returns the SAME thread, nested');
      assert.ok(resumed.model, 'and it reports the model the resumed thread will run');
      const turnId = await oneTurn(connB, b, threadId);
      const after = usageFor(b, turnId);

      // 🔒 ⚠ **THE MEASUREMENT.** If a resume RESTARTED the accounting, the resumed turn's `total`
      // would equal its own `last`. It does not: it equals the pre-resume total PLUS this turn.
      assert.equal(
        after.total.totalTokens,
        coldUsage.total.totalTokens + after.last.totalTokens,
        'thread/tokenUsage/updated.total is a RUNNING per-thread figure and a resume does not reset it',
      );
      assert.notEqual(
        after.total.totalTokens, after.last.totalTokens,
        'a resumed thread whose total equalled its last turn would mean the totals HAD reset',
      );

      // ⚠ `cachedInputTokens` IS INSIDE `inputTokens`, never added to it — the arithmetic
      // `normalize.js › tokensFrom` was corrected to on 2026-09-22.
      for (const breakdown of [after.last, after.total]) {
        assert.equal(
          breakdown.totalTokens, breakdown.inputTokens + breakdown.outputTokens,
          'totalTokens = input + output, so the cached figure is a SUBSET of input',
        );
      }
      assert.ok(
        after.modelContextWindow > 0,
        'the app-server reports the window it is metering against, on the same notification',
      );
    }

    // ── AND THE DECLARATION MATCHES WHAT WAS JUST MEASURED (`resumeParked` carries the baseline).
    assert.equal(
      RUNTIME_DESCRIPTOR.session.usageResetsOnResume, false,
      'the descriptor must state the measurement this test just made',
    );
  });
});

// ══ THE WIRE SHAPES, CONFIRMED AGAINST THE SERVER THAT ANSWERS ══════════════════════════════
//
// ⚠ NO MODEL TURN IN THIS DESCRIBE. `thread/start` and a rejected `turn/start` are local calls:
// the app-server refuses a malformed request during deserialization, long before it would reach a
// model, so the whole block is free.

describe('live: the v2 request shapes, and what happens to the old ones', () => {
  test('the pre-v2 shapes are REFUSED — the corrections are not a matter of taste', { timeout: 90000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    await withAppServer({ timeoutMs: 60000 }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-live'));
      const thread = await conn.request('thread/start', Object.assign({ cwd: WORKDIR }, SAFE_THREAD));
      const threadId = thread.thread.id;

      // ⚠ THE NESTED THREAD ID. A top-level `threadId` does not exist on this response; the handle
      // is `thread.id`, and the model the server SELECTED rides beside it at the top level.
      assert.ok(threadId, 'thread/start answers with a nested thread object carrying `id`');
      assert.equal(thread.threadId, undefined, 'and NOT a flat top-level threadId');
      assert.ok(thread.model, 'the response states the model the app-server actually picked');

      const refusals = [
        // TYPED INPUT ITEMS: a bare string prompt — the pre-v2 shape — is a type error.
        ['turn/start', { threadId, input: 'hello' }, /expected a sequence/],
        ['turn/start', { threadId }, /missing field `input`/],
        // ACTIVE TURN ID: steer and interrupt both REQUIRE the turn they are aimed at. Without it
        // there is no "current turn" fallback to land on, which is the whole point.
        ['turn/steer', { threadId, input: TRIVIAL }, /missing field `expectedTurnId`/],
        ['turn/interrupt', { threadId }, /missing field `turnId`/],
      ];
      for (const [method, params, pattern] of refusals) {
        await assert.rejects(conn.request(method, params), (err) => {
          assert.equal(err.code, -32600, `${method} must refuse, not accept`);
          assert.match(String(err.message), pattern);
          return true;
        });
      }
    });
  });

  test('🔒 a MISSPELLED policy field is SILENTLY IGNORED — which is why the echo is checked', { timeout: 90000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    await withAppServer({ timeoutMs: 60000 }, async (conn) => {
      await conn.request('initialize', client.initializeParams('0.0.0-live'));
      // The pre-v2 spelling. It does NOT error the way the turn shapes above do: the thread
      // starts, the field is dropped, and the server answers with its own default policy.
      const thread = await conn.request('thread/start', {
        cwd: WORKDIR, approval_policy: 'never', sandbox_mode: 'read-only',
      });
      assert.ok(thread.thread.id, 'an unrecognised field does not fail the request');
      assert.notEqual(
        thread.approvalPolicy, 'never',
        'and the asked-for policy did NOT take — a rename here widens a session in silence',
      );
      // ⚠ SO THE ECHO IS LOAD-BEARING, and `launch-spec.js › assertPolicyTook` is what reads it.
      assert.throws(
        () => launchSpec.assertPolicyTook({ approvalPolicy: 'never' }, thread),
        /run wider than the operator chose/,
      );
      // The correctly spelled field, on the same server, DOES take.
      const pinned = await conn.request('thread/start', Object.assign({ cwd: WORKDIR }, SAFE_THREAD));
      assert.equal(pinned.approvalPolicy, 'never');
      launchSpec.assertPolicyTook(SAFE_THREAD, pinned);
    });
  });
});

// ══ LIFECYCLE ARMS — the DoD's "the child exits cleanly on every path" ═══════════════════════
//
// ⚠ NONE OF THESE COSTS A MODEL TURN. `initialize` and `thread/start` are local calls, and the
// crash and shutdown arms never start a turn at all — so the whole describe is free and can stay
// in the release gate without a quota argument.

describe('live: every exit path ends the child', () => {
  const stillAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };

  test('SUCCESS: a completed handshake leaves no child behind', { timeout: 60000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    let pid = null;
    const out = await withAppServer({ timeoutMs: 30000 }, async (conn) => {
      pid = conn.child.pid;
      return conn.request('initialize', client.initializeParams('0.0.0-live'));
    });
    assert.ok(out && typeof out === 'object');
    assert.equal(stillAlive(pid), false, 'the child must be dead once the call returned');
  });

  test('REFUSAL: a method the server rejects still tears the child down', { timeout: 60000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    let pid = null;
    await assert.rejects(withAppServer({ timeoutMs: 30000 }, async (conn) => {
      pid = conn.child.pid;
      await conn.request('initialize', client.initializeParams('0.0.0-live'));
      return conn.request('dopl/noSuchMethod', {});
    }));
    assert.equal(stillAlive(pid), false);
  });

  test('CRASH: a killed child fails every waiting request instead of hanging it', { timeout: 60000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    const conn = openSession(t, () => {});
    {
      await conn.request('initialize', client.initializeParams('0.0.0-live'));
      const pid = conn.child.pid;
      // ⚠ THE PENDING REQUEST IS ISSUED BEFORE THE KILL. `client.js › rejectAll` on `exit` is the
      // only thing standing between a crashed app-server and a session that waits forever.
      const inflight = conn.request('thread/start', Object.assign({ cwd: WORKDIR }, SAFE_THREAD));
      process.kill(pid, 'SIGKILL');
      await assert.rejects(inflight, /codex app-server exited|spawn error/);
      await until(() => conn.isClosed(), 10000, 'the connection to report itself closed');
      assert.equal(stillAlive(pid), false);
    }
  });

  test('SHUTDOWN: closing the adapter handle kills the app-server it started', { timeout: 60000 }, async (t) => {
    if (skipLive(t, GATE)) return;
    // ⚠ THIS IS THE APP-QUIT ARM, through the REAL adapter rather than a bare connection: an
    // empty prompt iterator reaches `thread/start` and stops, so the handle owns a live child
    // with no turn running — exactly the state a quit finds a parked session in.
    async function* noPrompts() { /* the session never speaks */ }
    let pid = null;
    const realConnect = client.connect;
    client.connect = (options) => { const c = realConnect(options); pid = c.child.pid; return c; };
    let handle = null;
    t.after(() => { client.connect = realConnect; if (handle) handle.close(); });
    {
      handle = launchSpec.start({
        session: { key: 'live:codex:shutdown', profile: 'full', channelId: null, state: {} },
        args: [], env: process.env, cwd: WORKDIR, prompt: noPrompts(),
        threadStart: SAFE_THREAD, turnStart: {},
        dispatch: () => {},
      });
      // ⚠ **`dopl/threadStarted` IS NOT THE FIRST FRAME, AND NOTHING MAY ASSUME IT IS** (MEASURED
      // 2026-09-22): the app-server starts pushing notifications — `remoteControl/status/changed`,
      // `mcpServer/startupStatus/updated`, its own `thread/started` — the moment the child is up,
      // and `launch-spec.js` mints the synthetic frame only after `thread/start` RESOLVES. Core is
      // fine with that (`normalize.js` answers `[]` for a method it does not know), and this is
      // the shape that proves it rather than a suite pinned to a lucky ordering.
      const before = [];
      let launched = await handle.next();
      while (launched.value.method !== 'dopl/threadStarted') {
        before.push(launched.value.method);
        launched = await handle.next();
      }
      assert.ok(launched.value.params.threadId, 'a live thread/start yields a thread id');
      assert.ok(launched.value.params.model, 'and the model the app-server actually selected');
      for (const method of before) {
        assert.deepEqual(
          normalize.normalize({ method, params: {} }, {}), [],
          `a pre-launch \`${method}\` must normalize to nothing, not to a render event`,
        );
      }
      assert.ok(pid, 'the adapter spawned a child');
      assert.equal(stillAlive(pid), true, 'which is alive while the handle is open');
    }
    handle.close();
    await until(() => !stillAlive(pid), 10000, 'the child to exit after handle.close()');
  });

  test('the live session tier leaked no app-server processes', (t) => {
    if (skipLive(t, GATE)) return;
    assert.deepEqual(leakedPids(), []);
  });
});
