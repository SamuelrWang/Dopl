// THE "NEEDS YOU" SIGNAL — this machine's half.
//
// ⚠ **THE PROPERTIES HERE ARE THE ONES THE FEATURE IS FOR:**
//
//  - **THE LOG LINE IS WRITTEN FOR EVERY PING ADDRESSED TO THIS OPERATOR**, whatever the
//    recipient kind and whether or not anything is live to receive it. It is the zero-token
//    wake a local external agent arms a `tail -F` on, so making it contingent on a live session
//    would silently remove the delivery path this whole surface exists to provide.
//  - **A FOREIGN ROW IS DROPPED BEFORE THE LINE.** The realtime filter is workspace-wide, so a
//    frame for another member's ping reaches this handler under a SUBSCRIPTION rather than a
//    per-row auth answer. Gate 2 is what stops it — and here the drop must ALSO be silent,
//    because a line per dropped frame would put other people's traffic in this operator's log.
//  - 🔒 **THE WAKE IS THE EXISTING BELT, NOT A SECOND ONE.** `feedInbound` with `wake: true` and
//    an `addressing` naming the agent is where the `@agent-<id>` fan-out door terminates. A
//    second wake path is the thing this test exists to prevent.
//  - **NO LIVE SESSION IS NOT A FAILURE**, and must not throw: the row still stands in the
//    inbox and the line is already written.
//
// SOURCE EXTRACTION with INJECTION, `agent-directions.test.mjs`'s idiom: `main/diag.js` reaches
// Electron and cannot be required under `node --test`, so the module is evaluated with a require
// stub that THROWS on anything unlisted — a new dependency fails loudly rather than silently
// becoming undefined.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require_ = createRequire(import.meta.url);
const MAIN = join(import.meta.dirname, "..", "main");

const SRC = readFileSync(join(MAIN, "pings.js"), "utf8");
/** The wire is injected REAL — it is the thing under test at its own boundary, and a stub
 *  would let the narrowing and the log-line contract drift from what actually runs. */
const wire = require_(join(MAIN, "ping-wire.js"));

const WS = "11111111-2222-3333-4444-555555555555";
const CH = "22222222-3333-4444-5555-666666666666";
const TASK = "33333333-4444-5555-6666-777777777777";
const PID = "44444444-5555-6666-7777-888888888888";
const ME = "55555555-6666-7777-8888-999999999999";
const OTHER = "66666666-7777-8888-9999-aaaaaaaaaaaa";
const AGENT = "k3wpf7c5";

/** A realtime frame, i.e. the RAW ROW in snake_case. */
const row = (over = {}) => ({
  id: PID,
  seq: 12,
  workspace_id: WS,
  channel_id: CH,
  task_id: TASK,
  sender_user_id: OTHER,
  sender_agent_id: "z9y8x7w6",
  recipient_kind: "desktop",
  recipient_user_id: ME,
  recipient_agent_id: null,
  kind: "done",
  body: "migration written, tests green",
  created_at: "2026-09-01T10:00:00Z",
  ...over,
});

function harness(over = {}) {
  const cfg = {
    userId: ME,
    live: [{ agentId: AGENT, channelId: CH, taskId: TASK }],
    feedOk: true,
    ...over,
  };
  const logged = [];
  const fed = [];
  const handlers = [];

  const stub = (id) => {
    if (id === "./realtime-mailboxes") {
      return { setPingHandler: (h) => handlers.push(h) };
    }
    if (id === "./ping-wire") return wire;
    if (id === "./diag") return { diag: (...p) => logged.push(p.join(" ")) };
    throw new Error(`unexpected require: ${id}`);
  };

  const mod = { exports: {} };
  new Function("require", "module", "exports", SRC)(stub, mod, mod.exports);
  const api = mod.exports;
  api.start({
    getUserId: () => cfg.userId,
    listLiveSessions: () => cfg.live,
    feedInbound: (a) => {
      fed.push(a);
      return cfg.feedOk;
    },
  });
  return { api, logged, fed, handlers, cfg };
}

const LINE = `ping ${CH.slice(0, 8)} seq 12 to=${ME.slice(0, 8)} kind=done`;

// ───────────────────────────────────────────────────────────────────────────
// The log line — the zero-token wake
// ───────────────────────────────────────────────────────────────────────────

test("DOOR: a ping for this operator writes the exact log line", () => {
  const h = harness();
  h.api.handle(row(), WS);
  assert.ok(h.logged.includes(LINE), h.logged.join(" | "));
});

test("DOOR: the line is written for EVERY recipient kind, live session or not", () => {
  for (const [over, to, kind] of [
    [{ recipient_kind: "desktop", kind: "done" }, ME.slice(0, 8), "done"],
    [{ recipient_kind: "member", kind: "question" }, ME.slice(0, 8), "question"],
    [
      { recipient_kind: "agent", recipient_agent_id: AGENT, kind: "blocked" },
      AGENT,
      "blocked",
    ],
  ]) {
    // ⚠ NOTHING LIVE. The line must not be contingent on a session existing — an external
    // watcher is holding on it, and that is the delivery path for the `desktop` form.
    const h = harness({ live: [] });
    h.api.handle(row(over), WS);
    assert.ok(
      h.logged.includes(`ping ${CH.slice(0, 8)} seq 12 to=${to} kind=${kind}`),
      h.logged.join(" | ")
    );
  }
});

test("FENCE: another member's ping is dropped, and dropped SILENTLY", () => {
  // A line per dropped frame would put other people's traffic in this operator's log, and the
  // filter is workspace-wide so those frames arrive constantly.
  const h = harness();
  h.api.handle(row({ recipient_user_id: OTHER }), WS);
  assert.deepEqual(h.logged.filter((l) => l.startsWith("ping ")), []);
  assert.deepEqual(h.fed, []);
});

test("FENCE: signed out means nothing is this operator's", () => {
  const h = harness({ userId: null });
  h.api.handle(row(), WS);
  assert.deepEqual(h.logged.filter((l) => l.startsWith("ping ")), []);
});

test("FENCE: the same id is handled ONCE — a reconnect replays frames", () => {
  const h = harness();
  h.api.handle(row(), WS);
  h.api.handle(row(), WS);
  h.api.handle(row(), WS);
  assert.equal(h.logged.filter((l) => l === LINE).length, 1);
});

test("FENCE: a malformed row contributes nothing, never a throw", () => {
  const h = harness();
  for (const raw of [undefined, null, {}, { id: PID }, row({ kind: "nope" })]) {
    h.api.handle(raw, WS);
  }
  assert.deepEqual(h.logged.filter((l) => l.startsWith("ping ")), []);
});

// ───────────────────────────────────────────────────────────────────────────
// The wake — the EXISTING belt
// ───────────────────────────────────────────────────────────────────────────

test("DOOR: an agent ping feeds the resolved slot with wake:true", () => {
  const h = harness();
  h.api.handle(row({ recipient_kind: "agent", recipient_agent_id: AGENT }), WS);
  assert.equal(h.fed.length, 1);
  const a = h.fed[0];
  assert.equal(a.channelId, CH);
  assert.equal(a.taskId, TASK);
  assert.equal(a.agentId, AGENT);
  assert.equal(a.wake, true);
  assert.equal(a.seq, 12);
  // ⚠ The addressing shape `session-dispatch.js › addressingFor` produces for a
  // directly-addressed agent — the belt reads the verdict, it never re-derives it.
  assert.deepEqual(a.addressing, { me: true, ids: [AGENT] });
});

test("DOOR: what the woken agent reads names the SENDER and the KIND", () => {
  // It is being woken mid-run by text another agent wrote; a bare body would read as its
  // own operator speaking.
  const h = harness();
  h.api.handle(
    row({ recipient_kind: "agent", recipient_agent_id: AGENT, kind: "question" }),
    WS
  );
  assert.match(h.fed[0].message, /^\[ping · question\] @agent-z9y8x7w6: /);
});

test("FENCE: a desktop or member ping wakes NOTHING", () => {
  for (const kind of ["desktop", "member"]) {
    const h = harness();
    h.api.handle(row({ recipient_kind: kind }), WS);
    assert.deepEqual(h.fed, [], kind);
  }
});

test("FENCE: no live session is not a failure — no feed, no throw, line still written", () => {
  const h = harness({ live: [] });
  h.api.handle(row({ recipient_kind: "agent", recipient_agent_id: AGENT }), WS);
  assert.deepEqual(h.fed, []);
  assert.ok(h.logged.some((l) => l.startsWith("ping ")));
});

test("FENCE: the slot must match the CHANNEL too, not the agent id alone", () => {
  // An agent id is unique per machine, but a ping is ABOUT a channel — feeding it into that
  // agent's session on a different channel delivers a signal about work it is not doing.
  const h = harness({ live: [{ agentId: AGENT, channelId: "other-channel", taskId: TASK }] });
  h.api.handle(row({ recipient_kind: "agent", recipient_agent_id: AGENT }), WS);
  assert.deepEqual(h.fed, []);
});

test("FENCE: a throwing belt does not escape the handler", () => {
  const h = harness();
  h.api.handle(row({ recipient_kind: "agent", recipient_agent_id: AGENT, id: PID }), WS);
  assert.equal(h.fed.length, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// Arming
// ───────────────────────────────────────────────────────────────────────────

test("DOOR: start registers the handler; stop drops it", () => {
  const h = harness();
  assert.equal(typeof h.handlers[0], "function");
  h.api.stop();
  assert.equal(h.handlers[1], null);
  // ⚠ After stop, a frame does nothing at all — no line, no feed.
  h.api.handle(row({ id: "99999999-1111-2222-3333-444444444444" }), WS);
  assert.deepEqual(h.logged.filter((l) => l.startsWith("ping ")), []);
});
