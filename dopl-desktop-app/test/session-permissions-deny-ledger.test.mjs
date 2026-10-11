// The two per-session deny ledgers in `main/session-permissions.js` — `autoDeniedIds` (no
// surface: nobody was asked) and `gateTimeoutIds` (asked, nobody answered) — drive which sentence
// a refused tool call carries. Since cleanup D07 both are written through one helper keyed by a
// STRING (`noteBounded(s, key, id)`), so a swapped key or a lost eviction is one typo away. These
// cases drive the REAL module and pin both: each note reaches its own sentence through
// `resolvePerm`, and each ledger stays bounded with the oldest id evicted first.
//
// Run: `node --test dopl-desktop-app/test/session-permissions-deny-ledger.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const perms = require(join(HERE, "..", "main", "session-permissions.js"));

// `MAX_AUTO_DENIED` in session-permissions.js; the bound both ledgers share.
const BOUND = 64;

function session() {
  return { pendingPermissions: new Map(), pendingNames: new Map() };
}

/** Park a held call, then deny it the way the reducer does; returns the message the agent gets. */
function denyHeld(s, rid) {
  let answer = null;
  s.pendingPermissions.set(rid, (a) => { answer = a; });
  s.pendingNames.set(rid, "Bash#x");
  assert.equal(perms.resolvePerm(s, rid, "deny"), true, "control: a live resolver was taken");
  assert.equal(answer && answer.behavior, "deny");
  return answer.message;
}

test("each ledger reaches its OWN sentence: timeout, auto-deny and a real decision differ", () => {
  const s = session();
  perms.noteGateTimeout(s, "r-timeout");
  perms.noteAutoDenied(s, "r-auto");
  const timeout = denyHeld(s, "r-timeout");
  const auto = denyHeld(s, "r-auto");
  const human = denyHeld(s, "r-human");
  assert.match(timeout, /refused by a TIMER/, "an expired prompt says a timer refused it");
  assert.doesNotMatch(timeout, /NOBODY WAS ASKED/, "…and never that nobody was asked (a prompt WAS shown)");
  assert.match(auto, /NOBODY WAS ASKED/, "the no-surface deny says nobody was asked");
  assert.doesNotMatch(auto, /TIMER/);
  assert.equal(human, perms.OPERATOR_DENY_MESSAGE, "an unnoted id is a real decision");
  assert.equal(new Set([timeout, auto, human]).size, 3);
});

test("each ledger is bounded and evicts its oldest id first", () => {
  for (const [note, key] of [[perms.noteAutoDenied, "autoDeniedIds"], [perms.noteGateTimeout, "gateTimeoutIds"]]) {
    const s = session();
    for (let i = 0; i <= BOUND; i++) note(s, `r${i}`); // BOUND + 1 notes
    const set = s[key];
    assert.ok(set instanceof Set, `${key} is the ledger the note writes`);
    assert.equal(set.size, BOUND, `${key} holds at most ${BOUND}`);
    assert.equal(set.has("r0"), false, `${key}: the oldest id went first`);
    assert.equal(set.has("r1"), true, `${key}: only one was evicted`);
    assert.equal(set.has(`r${BOUND}`), true, `${key}: the newest is kept`);
  }
});
