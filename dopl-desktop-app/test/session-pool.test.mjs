// `sessionKey` HAS EXACTLY ONE DEFINITION IN main/, AND EVERY CALLER IMPORTS IT.
//
// ⚠ REWRITTEN DOWN, NOT REMOVED (2026-08-20, Samuel's ruling; INVARIANTS §14). This file was
// `main/session-pool.js`'s suite — the HEADLESS spawn pool (D1, 2026-07-31) — and thirteen of its
// fourteen cases drove that module: claim / release / same-key exclusivity / the global cap of 4 /
// `listActive` accounting / the at-cap defer composed with the queued notice. `session-pool.js` is
// DELETED with the `claude -p` lane it guarded, so all thirteen are gone. The `SESSION-POOL-PURE`
// slice they shared now reads the empty string against a missing file, and a suite that cannot
// even slice its subject is not a weakened test, it is a crash.
//
// ⚠ ONE CASE WAS NEVER ABOUT THE POOL, AND IT IS THE REASON THIS FILE STILL EXISTS. "sessionKey is
// defined once, in session-store.js, and everyone else imports it" is a property of the TREE, not
// of any module's behaviour: nothing you can CALL proves that no second definition exists
// somewhere in main/. It was filed here because the pool was the change that made the key shared
// in the first place, and deleting the whole file — the obvious move, since its title names a
// deleted module — is exactly the twice-repeated mistake §14 was written for.
//
// WHAT THE RULE IS WORTH. `sessionKey(channelId, taskId)` is the (channel, thread) identity the
// engine registry, `queued-notice.js`'s per-thread dedupe and `session-reopen.js` / `session-park.js`'s
// resolution all name a session by. A second spelling anywhere would not throw and would not fail a
// behavioural test — it would silently give one caller a different session than another, which is
// how a notice dedupes against nothing or a reopen wakes the wrong shell.
//
// ⚠ WHAT WENT WITH THE THIRTEEN, so nobody looks for it here: the cap. `MAX_CONCURRENT_SESSIONS`
// was the HEADLESS ceiling and is deleted with it. The live concurrency ceiling is the ENGINE's,
// and a launch refused by it now reaches the peer through `trigger.js`'s `CANNOT_RUN` terminal —
// pinned in `test/inbound-approved-terminals.test.mjs`, not here.
//
// Run: `node --test dopl-desktop-app/test/session-pool.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");

// ── sessionKey has exactly ONE definition (source probe) ─────────────────────

test("sessionKey is defined once, in session-store.js, and everyone else imports it", () => {
  // Source-probed on purpose: "no second definition anywhere in main/" is a property of the
  // TREE, not of any one module's behavior, so nothing you can call proves it.
  const files = readdirSync(MAIN).filter((f) => f.endsWith(".js"));
  const DEFINE = /(?:function\s+sessionKey\s*\(|(?:const|let|var)\s+sessionKey\s*=)/g;
  // This codebase documents itself heavily, so a `store.sessionKey(...)` inside a comment is
  // prose, not a call site. Strip line comments before asking who CALLS it.
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const definers = [];
  const users = [];
  for (const f of files) {
    const src = code(readFileSync(join(MAIN, f), "utf8"));
    if (src.match(DEFINE)) definers.push(f);
    if (/(?:^|[^A-Za-z.])(?:store|sessionStore)?\.?sessionKey\(/m.test(src) && f !== "session-store.js") users.push(f);
  }
  assert.deepEqual(definers, ["session-store.js"], "the (channel, thread/agent) key has ONE definition");
  // ⚠ THE FLOOR IS AN ANTI-VACUITY GUARD, NOT A TARGET. What it defends is the loop below: if the
  // `users` regex ever stops matching, `for (const f of [])` runs zero assertions and this case
  // goes green having checked nothing. It is NOT a claim that the key SHOULD have three callers.
  // ⚠ IT HAS BEEN RE-BASED TWICE, AND BOTH TIMES BY A DELETION RATHER THAN BY A RELAXATION.
  // 4 -> 3 on 2026-08-20 when the session-window retirement (F-228) deleted `session-ipc.js`,
  // `session-history.js`, `session-window.js` and `attended-handoff.js`; then 3 -> 2 the SAME day
  // when Samuel's headless ruling deleted `session-spawner.js`'s executor half, which held the
  // last of the three. `session-park.js` names the key only in prose (it resolves through
  // `slotKey`), so the comment-stripping filter above correctly does not count it. Re-measure
  // rather than relax — this is a floor against a regex that stopped matching, not a target:
  //   grep -lE '(^|[^A-Za-z.])(store|sessionStore)?\.?sessionKey\(' main/*.js
  // ⚠ AT 2 THIS IS CLOSE TO ITS OWN FLOOR. If the next deletion takes it to 1, do NOT drop the
  // guard to 1 — a single caller means the "everyone imports it" half is testing one file, and
  // the case should be re-anchored on `slotKey` (the shape that actually carries an agent) or
  // retired with a finding, not quietly weakened.
  assert.ok(users.length >= 2, `expected several importers, found ${users.length}: ${users}`);
  for (const f of users) {
    const src = readFileSync(join(MAIN, f), "utf8");
    assert.match(src, /require\('\.\/session-store'\)/, `${f} calls sessionKey but does not import it`);
  }
});

// ⚠ THE POOL'S OWN THIRTEEN CASES STOOD HERE AND ARE DELETED WITH `main/session-pool.js`
// (2026-08-20, Samuel's ruling). For the record of what they pinned, because the three properties
// were load-bearing together and a future concurrency guard will want the same shape:
//   (1) two DIFFERENT keys in one channel ran concurrently — the point of the D1 change, which
//       replaced a per-CHANNEL binary that made a second thread wait 2m13s for pickup;
//   (2) the SAME key twice was refused, and said `same-key` even at the cap, so a duplicate was
//       never misreported as a concurrency ceiling;
//   (3) the (cap+1)th claim deferred exactly like the busy path, and one release admitted exactly
//       one — plus `release` idempotent, `listActive` a pure read, and the slot keyed on `slotKey`
//       so N agents of one channel did not collapse onto `channelId + ':'`.
// None of it survives the deletion of the lane: there is no second executor and no second pool.
// The ENGINE holds the only registry now, and its own refusals are covered by
// `test/inbound-approved-terminals.test.mjs` (the terminal) and `test/queued-notice.test.mjs`
// (the in-thread milestone), which is where the at-cap composition case moved in substance.
