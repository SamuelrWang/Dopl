// THE REMOVED VOCABULARY OF THE CHANNELS ROLLBACK — a regrowth guard (2026-08-05, F-146),
// now also carrying THREAD CLOSING (2026-08-18, wiring plan Phase 4).
//
// WHY THIS EXISTS. The rollback (§1, F-141) deleted eight main-process modules, and the residue
// it left behind was not code — it was PROSE. Twenty-odd comments across the tree still named
// those modules, and in this codebase a comment is load-bearing: agents read them instead of
// re-reading the source, so a paragraph that says `channel-agents.routeAddressedAgent` claims a
// message "ahead of classify" in the present tense is a confident wrong answer waiting to be
// acted on. Three such lines survived the rollback's own sweep and were only found by grepping
// for the vocabulary; this test is that grep, made cheap and repeatable.
//
// WHAT IT ASSERTS, in three tiers, weakest requirement last:
//
//   1. THE FILES ARE GONE. A deleted module must not exist on disk. This is the one that would
//      catch somebody restoring a file from git history without restoring the decision.
//   2. NOTHING REQUIRES ONE. A `require('./channel-agents')` anywhere in main/ is the failure
//      that actually breaks the app at load — `module.exports` is EVALUATED, and the rollback
//      already shipped one `ReferenceError: sessionTeam is not defined` for exactly this reason
//      (see `session-engine.js`'s export list). Cheap to assert, catastrophic to miss.
//   3. EVERY MENTION IS ANNOTATED AS HISTORY. A removed name may still appear in a comment —
//      it SHOULD, because the rollback bullets explain what was removed by naming it — but the
//      comment block it sits in has to say so. The check walks the contiguous comment block
//      around each hit and requires a deletion marker in it.
//
// TIER 3 IS DELIBERATELY A BLOCK CHECK, NOT A LINE CHECK. The honest annotations in this tree run
// several lines ("X used to do Y … that module is gone (channels rollback §1)"), so demanding the
// marker on the same line would fail every correct comment in the codebase. A block is the unit a
// reader actually takes in. It is also why this cannot be an eslint rule: no lint rule knows what
// a paragraph MEANS, and the point here is meaning.
//
// HOW TO FIX A FAILURE. Do not add a marker word to silence it. Read the paragraph and decide
// whether it is history (annotate it) or a claim about live behaviour (it is wrong — the module
// does not exist). If a module legitimately comes back, delete its entry from REMOVED below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "main");

// The eight main-process modules the rollback deleted (ENGINEERING §18, "THE DESKTOP LOST EIGHT
// MODULES AND TWO CLASSIFY RULES"), plus the two-word forms a comment reaches for.
//
// ⚠ A NINTH JOINED THEM ON 2026-08-18 (wiring plan Phase 4): `session-close-task`, the module
// that PATCHed `{op:"close"}` at `channel_tasks` when the operator closed a thread from the
// session window. Threads do not close, the route arm is gone, and the whole lane behind it —
// the renderer panel, the `session:close-task` IPC handler, the reducer's `close_task` branch —
// went in the same change. It earns its place here for the tier-2 reason above all: the engine
// still `require`d it, and a `module.exports` read at load time is not a dead branch.
//
// ⚠ TWELVE MORE JOINED THEM ON 2026-08-20 — THE SESSION-WINDOW DELETION (F-228) AND SAMUEL'S TWO
// RULINGS. This is now the enforcement mechanism for the largest deletion this tree has taken,
// and tier 2 is why it matters more than ever: `session-engine.js` alone lost eight requires,
// and one survivor would be a load-time `ReferenceError` rather than a dead branch.
//   the window lane   session-window · session-shell · session-ipc · session-consent ·
//                     session-replay · session-peer-post · session-history · session-history-copy
//   attended handoff  attended-handoff · attended-prompt (reachable only from a pre-consent card)
//   the headless lane trigger-headless · session-pool (Samuel: one executor, not two)
// ⚠ THREE MORE JOINED THEM ON 2026-08-22 — THE INBOUND CONSENT RETIREMENT (Samuel's ruling).
// `consent-watcher` / `consent-store` / `consent-cadence` were the whole approve-IN lane: the poll
// loop that watched a server `inbound` row off the long-poll loop, its electron-store durability
// (the watched map + the settled-key TTL), and its adaptive scan cadence. A peer's ask now raises
// a NOTIFICATION whose button LAUNCHES and whose Dismiss decides nothing — there is no row, no
// record and nothing to re-poll. ⚠ `main/consent.js` is deliberately NOT on this list: it is LIVE
// and owns the OUTBOUND row (`session-windowless.js › bridgeOutbound`), which is untouched.
// Tier 2 is the one that matters here as always: `trigger.js`, `trigger-outcomes.js` and
// `channel-listener.js` each `require`d the watcher, and `module.exports` is read at load.
const REMOVED = [
  "consent-watcher",
  "consent-store",
  "consent-cadence",
  "channel-agents",
  "channel-roster",
  "channel-engagement",
  "channel-threads",
  "channel-deliver",
  "session-team",
  "session-greeting",
  "realtime-agents",
  "session-close-task",
  "session-window",
  "session-shell",
  "session-ipc",
  "session-consent",
  "session-replay",
  "session-peer-post",
  "session-history",
  "session-history-copy",
  "attended-handoff",
  "attended-prompt",
  "trigger-headless",
  "session-pool",
];

// ⚠ `session-history` IS A PREFIX OF NOTHING, BUT `session-window` IS. The MENTION regex below
// is a plain alternation, so `session-window` also matches inside `session-windowless` — a LIVE
// module named in live comments. Bounded on the right by a non-identifier character so the two
// cannot be confused; without it every honest sentence about the windowless lane fails tier 3.
// ⚠ AND IT HAPPENED AGAIN, TO A DIFFERENT NAME, ON 2026-08-20: the F-226 split created a LIVE
// `main/session-ipc-ops.js`, which the bare alternation matched as the deleted `session-ipc`.
// A one-off trap for one name was the wrong shape — the RULE is that every removed name must be
// bounded on the right, so the general form below replaces the special case. `(?![a-z-])` stops
// a match running on into another hyphenated segment (`session-ipc` vs `session-ipc-ops`) or
// into more letters (`session-window` vs `session-windowless`), while still allowing `.js`,
// a backtick, a space or a full stop to follow.
const RIGHT_BOUND = "(?![a-z-])";

// A mention is `<module>.<something>` (a call), `<module>.js` (a file reference) or the bare
// module name. Bare is included on purpose: `channel-deliver` and `realtime-agents` are named
// without a suffix in real comments.
const MENTION = new RegExp(
  REMOVED.map((m) => `${m.replace(/-/g, "\\-")}${RIGHT_BOUND}`).join("|")
);

// Words that make a paragraph HISTORY rather than a claim. Kept broad — the failure this test is
// for is a paragraph with no acknowledgement at all, not one that phrases it unusually.
const ANNOTATED =
  /\b(deleted|delete|gone|went with|used to|no longer|gone with|removed|gone\b|gone\.|rollback|gone,|not exist|gone;)\b/i;

const mainFiles = () =>
  readdirSync(MAIN)
    .filter((f) => f.endsWith(".js"))
    .sort();

// The contiguous run of `//` comment lines containing `idx`. A blank line, a code line or the top
// of the file ends the block. Comments in this tree are line comments throughout.
function commentBlock(lines, idx) {
  const isComment = (i) =>
    i >= 0 && i < lines.length && /^\s*\/\//.test(lines[i]);
  if (!isComment(idx)) return null; // the hit is on a CODE line, not a comment
  let start = idx;
  while (isComment(start - 1)) start -= 1;
  let end = idx;
  while (isComment(end + 1)) end += 1;
  return lines.slice(start, end + 1).join("\n");
}

test("every module the channels rollback deleted is actually gone from main/", () => {
  for (const name of REMOVED) {
    const path = join(MAIN, `${name}.js`);
    assert.equal(
      existsSync(path),
      false,
      `main/${name}.js exists — it was deleted in the channels rollback (§1, F-141). ` +
        `If it is genuinely back, remove it from REMOVED in this test and say why in ENGINEERING §18.`
    );
  }
});

test("nothing in main/ requires a deleted module", () => {
  // `module.exports` is evaluated at require time, so a stale reference is not a dead branch —
  // it throws on load and takes the whole engine with it. The rollback shipped exactly that bug.
  const offenders = [];
  for (const file of mainFiles()) {
    const src = readFileSync(join(MAIN, file), "utf8");
    for (const name of REMOVED) {
      const re = new RegExp(`require\\(\\s*['"]\\./${name}(\\.js)?['"]\\s*\\)`);
      if (re.test(src)) offenders.push(`main/${file} -> ./${name}`);
    }
  }
  assert.deepEqual(offenders, [], `a deleted module is being required:\n${offenders.join("\n")}`);
});

test("every surviving mention of a deleted module is annotated as history, not stated as live", () => {
  const bare = [];
  for (const file of mainFiles()) {
    const lines = readFileSync(join(MAIN, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!MENTION.test(line)) return;
      const block = commentBlock(lines, i);
      if (block === null) {
        // A mention on a CODE line is a live reference to a deleted module. Tier 2 catches the
        // require form; anything else here is still worth refusing.
        bare.push(`main/${file}:${i + 1} (code line, not a comment) ${line.trim()}`);
        return;
      }
      if (!ANNOTATED.test(block)) {
        bare.push(`main/${file}:${i + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    bare,
    [],
    "these comments name a module the channels rollback deleted, in a block that never says it " +
      "is gone — an agent reading them will act on a surface that does not exist:\n" +
      bare.join("\n")
  );
});

// ── THE RETIRED STORE KEYS (2026-08-20) ─────────────────────────────────────────────────
//
// ⚠ THIS SECTION REPLACES `test/pre-consent-window-default.test.mjs`, deleted with its subject.
// That file evaluated `settings.getWindowMode()` / `getPreConsentWindow()` against a fake store
// and asserted they answered OFF for EVERY stored value — the disarmed-guard record F-228 asked
// for, kept one wave longer than the machinery so nothing could re-arm in the gap.
//
// The switches are gone now, and the rule that outlives them is sharper and cheaper: a machine
// that ran an older build may STILL CARRY `sessionWindowMode: true` on disk. Nothing reads it.
// A reader added back would resurrect the sender-side session pop-up for precisely the installs
// that used to have it — the self-trigger bug the whole retirement was ruled from.
// ⚠ `claudeSessions` JOINED 2026-08-20. It was the `claude -p` headless lane's resumable
// session-id map; that lane was deleted the same day (Samuel's ruling) and the key was left
// with no reader — recorded in `session-spawner.js`'s header but pinned nowhere, which is the
// asymmetry this list exists to close. A reader for it would resume a session against an
// executor that no longer exists.
// ⚠ THREE MORE JOINED 2026-08-22 WITH THE INBOUND CONSENT RETIREMENT. `pendingConsent` was the
// Round-B per-channel hold; `channelWatched` / `channelSettled` were `consent-store.js`'s durable
// pending-request map and its no-replay settled-key set. All three are still on shipped machines'
// disks and NOTHING may read them: a reader would resurrect a decision surface that has no
// decision behind it, and `channelSettled` in particular would suppress asks whose "settlement"
// was recorded by a lane that no longer exists. `main/listener-io.js` names all three in prose,
// which is how the next reader finds this.
const RETIRED_STORE_KEYS = [
  "sessionWindowMode", "preConsentWindowMode", "claudeSessions",
  "pendingConsent", "channelWatched", "channelSettled",
];

test("no retired window store key has a reader anywhere in main/", () => {
  for (const key of RETIRED_STORE_KEYS) {
    for (const file of mainFiles()) {
      const src = readFileSync(join(MAIN, file), "utf8");
      const lines = src.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!line.includes(key)) return;
        // A mention is fine — it is how the next reader finds this decision. A READ is not.
        assert.ok(
          /^\s*\/\//.test(line),
          `main/${file}:${i + 1} touches the retired key \`${key}\` in CODE. ` +
            `It is never read and never written (F-228): a reader resurrects the session window ` +
            `for every install that still has the value on disk.`
        );
        const block = commentBlock(lines, i);
        assert.ok(
          block && ANNOTATED.test(block),
          `main/${file}:${i + 1} names \`${key}\` in a comment that does not say it is retired.`
        );
      });
    }
  }
});
