// DELETING ONE AGENT (2026-08-25, Samuel's ruling) — `main/session-delete-op.js`.
//
// THE PROPERTIES THAT FAIL QUIETLY, which is why each is pinned here:
//
//  - **END, THEN PURGE — IN THAT ORDER, AND THROUGH THE ONE STOP PATH.** A live agent is stopped
//    by dispatching the SAME reducer event `sessions:end` dispatches, and `settle` is what
//    FREEZES the history this purge then drops. Reversed, the purge runs first and `settle`
//    writes the record back a moment later — the card the operator deleted comes straight back,
//    and nothing anywhere reports it. A second teardown of its own would be the C3 orphan (a
//    `claude` child still holding this session's pre-approved `dopl_channel` access).
//  - **EVERY LOCAL STORE, OR IT IS AN ORPHAN.** The list is `agent-retention.js`'s, and a delete
//    that cleaned its own four of five would be that file's "slow leak with a comforting name",
//    one card at a time. The purge therefore goes THROUGH that module rather than beside it.
//  - **⚠ THE CHANNEL RECORD IS IMMUTABLE BY THIS OP.** Nothing here can reach `channel_messages`
//    — the SPA half of that claim is pinned in
//    `src/features/channels/components/channels-v2/agent-delete.test.tsx`, which renders a
//    transcript before and after a deletion. What is asserted HERE is the other half: this lane
//    performs no network call and touches no server store, and the ONLY server-visible effect is
//    the one an ordinary `end` already has.
//  - **THE AGENT ID IS REQUIRED.** Every other op resolves an omitted id to the OLDEST live agent
//    on the thread. For a destructive verb that is a DIFFERENT agent than the card that was
//    clicked, with nothing reporting the substitution.
//
// SOURCE EXTRACTION: the module is evaluated whole against a stub `require`, so the REAL guards
// (`ipc-guards.js`'s UUID gate, `agent-id.js`'s charset) are the ones under test and every store
// is a fake that records.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const read = (f) => readFileSync(join(MAIN, f), "utf8");
const req = createRequire(import.meta.url);

// The REAL predicates — a permissive fake would accept ids and channel ids main refuses.
const realAgentId = req(join(MAIN, "agent-id.js"));
const GUARDS = read("ipc-guards.js");
const realGuards = new Function(
  `${GUARDS.slice(GUARDS.indexOf("// ─── BEGIN IPC-GUARDS"), GUARDS.indexOf("// ─── END IPC-GUARDS"))}
   return { isUuid, isAppWindowSender, UUID_RE };`
)();

const CH = "44444444-4444-4444-8444-444444444444";
const AGENT = "a1b2c3d4";
const KEY = `${CH}:t-1:${AGENT}`;
const PAYLOAD = { channelId: CH, taskId: "t-1", agentId: AGENT };

/**
 * Build the op over recording fakes. `live` decides whether the registry still holds the agent,
 * `retained` whether a frozen history record exists for the key.
 * ⚠ THE END FAKE WRITES THE HISTORY, exactly as `session-teardown.js › settle` does inside the
 * dispatch — without that, the ordering property below could not fail.
 */
function build({ live = false, retained = false } = {}) {
  const log = [];
  const history = retained ? { [KEY]: { key: KEY } } : {};
  const stub = (id) => {
    if (id === "./ipc-guards") return realGuards;
    if (id === "./agent-id") return realAgentId;
    if (id === "./diag") return { diag: () => {} };
    if (id === "./session-store") return { slotKey: (a) => `${a.channelId}:${a.taskId}:${a.agentId}` };
    if (id === "./session-engine") {
      return {
        controlByTask: (a) => {
          log.push({ op: "end", address: a });
          if (!live) return { ok: false, reason: "no-session" };
          // `settle` freezes the ring BEFORE the registry entry goes — the write this
          // deletion must then drop, and the reason the order is asserted below.
          history[KEY] = { key: KEY };
          log.push({ op: "settle-wrote-history" });
          return { ok: true };
        },
      };
    }
    if (id === "./agent-history") {
      return { historyFor: (k) => history[k] || null };
    }
    if (id === "./agent-retention") {
      return {
        forgetAgent: (k) => {
          delete history[k];
          log.push({ op: "purge", key: k });
          return [k];
        },
      };
    }
    if (id === "./agent-names") return { clear: (a) => log.push({ op: "clear-name", agentId: a }) };
    if (id === "./agent-window") return { closeAgentWindow: (a) => log.push({ op: "close-window", address: a }) };
    if (id === "./session-summary") return { touch: () => log.push({ op: "touch" }) };
    throw new Error(`unexpected require: ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", read("session-delete-op.js"))(stub, mod, mod.exports);
  return { deleteAgent: mod.exports.deleteAgent, log, history };
}

const ops = (log) => log.map((e) => e.op);

// ── 1. THE ORDER ─────────────────────────────────────────────────────────────

test("LIVE: it ENDS the agent first, then purges — and the purge outlives settle's write", () => {
  // ⚠ THE FAILURE THIS PINS is invisible in production: purge-then-end lets `settle` re-record
  // the history a moment later and the deleted card comes back on the next push.
  const { deleteAgent, log, history } = build({ live: true });
  assert.deepEqual(deleteAgent(PAYLOAD), { ok: true, ended: true });
  assert.deepEqual(ops(log), [
    "end", "settle-wrote-history", "purge", "clear-name", "close-window", "touch",
  ]);
  assert.equal(history[KEY], undefined, "the record settle just froze is gone");
});

test("LIVE: the end goes through the ONE stop path, addressed EXACTLY", () => {
  // The same `controlByTask` the End button reaches — never a teardown written for delete — and
  // with the agent NAMED, so a sibling on the same thread can never be the one that stops.
  const { deleteAgent, log } = build({ live: true });
  deleteAgent(PAYLOAD);
  assert.deepEqual(log[0], {
    op: "end",
    address: { channelId: CH, taskId: "t-1", agentId: AGENT, action: "end" },
  });
});

test("ENDED: a retained agent purges directly — nothing is stopped", () => {
  const { deleteAgent, log, history } = build({ retained: true });
  assert.deepEqual(deleteAgent(PAYLOAD), { ok: true, ended: false });
  // `end` is still ATTEMPTED — an ended agent left the registry, so its refusal is the ordinary
  // case and is read as "there was nothing live", never as a failure.
  assert.deepEqual(ops(log), ["end", "purge", "clear-name", "close-window", "touch"]);
  assert.equal(history[KEY], undefined);
});

// ── 2. WHAT ELSE GOES ────────────────────────────────────────────────────────

test("THE PURGE RUNS THROUGH `agent-retention`, on the EXACT key — never a prefix", () => {
  // ⚠ The per-agent store list is that module's whole reason to exist; a second list here would
  // be the orphan it prevents, arriving through the door nobody is watching. And the key is all
  // three segments: a `<channel>:<thread>:` prefix is the THREAD cascade, and reaching a sibling
  // agent from one card's trash icon is the mistake this lane cannot make quietly.
  const { deleteAgent, log } = build({ retained: true });
  deleteAgent(PAYLOAD);
  assert.deepEqual(log.find((e) => e.op === "purge"), { op: "purge", key: KEY });
});

test("THE DISPLAY NAME GOES WITH THE AGENT, keyed by the id the sweep cannot reach", () => {
  // Samuel's "all information attached" ruling. `agent-names.js` is keyed by `agentId`, not by
  // session key, so `agent-retention.js`'s key-shaped cleaners cannot see it and this lane
  // clears it itself. Transcripts fall back to `Agent #<id>`.
  const { deleteAgent, log } = build({ retained: true });
  deleteAgent(PAYLOAD);
  assert.deepEqual(log.find((e) => e.op === "clear-name"), { op: "clear-name", agentId: AGENT });
});

test("AN OPEN WINDOW ONTO THE AGENT IS CLOSED — a composer pointed at nothing is worse than none", () => {
  const { deleteAgent, log } = build({ live: true });
  deleteAgent(PAYLOAD);
  assert.deepEqual(log.find((e) => e.op === "close-window"), {
    op: "close-window",
    address: { channelId: CH, taskId: "t-1", agentId: AGENT },
  });
});

test("THE CARD LEAVES ON THE NEXT PUSH — the projection is touched", () => {
  const { deleteAgent, log } = build({ retained: true });
  deleteAgent(PAYLOAD);
  assert.equal(ops(log).includes("touch"), true);
});

// ── 3. REFUSALS ──────────────────────────────────────────────────────────────

test("REFUSAL: a bad channel id or a missing agent id is a BARE `{ok:false}`", () => {
  // Byte-identical to the sender binding's own refusal, so a hostile page cannot learn which
  // gate it hit — this file's boundary rule (`session-ipc-ops.js`'s header).
  const { deleteAgent, log } = build({ live: true });
  for (const bad of [
    undefined,
    {},
    { ...PAYLOAD, channelId: "not-a-uuid" },
    { ...PAYLOAD, agentId: "" },
    { ...PAYLOAD, agentId: "NOT-AN-ID" },
    { ...PAYLOAD, agentId: "../../etc" },
  ]) {
    assert.deepEqual(deleteAgent(bad), { ok: false }, JSON.stringify(bad));
  }
  assert.deepEqual(log, [], "a refused payload reaches no store and stops nothing");
});

test("REFUSAL: an address naming NO agent answers `no-agent` and destroys nothing", () => {
  // Neither live nor retained. A silent success over nothing is the swallow this family has been
  // bitten by twice (`AGENT_CONTROL_REFUSED`, and the reopen that reported success having opened
  // nothing) — the word is free here because the guard has already passed.
  const { deleteAgent, log } = build({});
  assert.deepEqual(deleteAgent(PAYLOAD), { ok: false, reason: "no-agent" });
  assert.deepEqual(ops(log), ["end"], "it tried to stop something and then stopped");
});

test("REFUSAL: an agentId is REQUIRED even when the thread holds exactly one agent", () => {
  // ⚠ THE ONE OP IN THIS FAMILY WITHOUT THE OLDEST-LIVE FALLBACK. Everywhere else an omitted id
  // degrades to the oldest live agent on the thread, which is byte-for-byte what a caller got
  // before multiplayer; for a DESTRUCTIVE verb that is a different agent than the card clicked.
  const { deleteAgent } = build({ live: true });
  assert.deepEqual(deleteAgent({ channelId: CH, taskId: "t-1" }), { ok: false });
});

// ── 4. THE STORES IT MAY NOT REACH ───────────────────────────────────────────

test("⚠ IT REACHES NO NETWORK AND NO SERVER STORE — deletion is LOCAL", () => {
  // The stub `require` THROWS on anything not named above, so the set of modules this lane can
  // touch is exactly the list in `build()`: the guards, the key, the engine's own stop verb, and
  // four LOCAL stores. `main/api.js`, `channel-post.js` and `session-state-push.js` are absent
  // and adding one would fail every case in this file.
  const SRC = read("session-delete-op.js");
  for (const banned of ["fetch(", "./api", "channel-post", "session-state-push", "channel_messages"]) {
    assert.equal(SRC.includes(`require('${banned}')`), false, `must not require ${banned}`);
  }
  assert.equal(/fetch\s*\(/.test(SRC.replace(/^\s*\/\/.*$/gm, "")), false, "no network call");
});

test("⚠ IT IS ONE STOP PATH: the source dispatches END, it does not settle or abort itself", () => {
  // A second teardown is a second set of the C3 bugs. `settle`, `abort` and `kill` must not
  // appear as CODE here — the delete lane asks the engine and the engine tears down.
  const CODE = read("session-delete-op.js")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
  assert.match(CODE, /controlByTask\(/, "it goes through the engine's own stop verb");
  for (const banned of ["settle(", "abortController", ".kill(", "pushIterator"]) {
    assert.equal(CODE.includes(banned), false, `${banned} would be a second teardown`);
  }
});
