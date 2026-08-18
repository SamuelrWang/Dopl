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
const REMOVED = [
  "channel-agents",
  "channel-roster",
  "channel-engagement",
  "channel-threads",
  "channel-deliver",
  "session-team",
  "session-greeting",
  "realtime-agents",
  "session-close-task",
];

// A mention is `<module>.<something>` (a call), `<module>.js` (a file reference) or the bare
// module name. Bare is included on purpose: `channel-deliver` and `realtime-agents` are named
// without a suffix in real comments.
const MENTION = new RegExp(REMOVED.map((m) => m.replace(/-/g, "\\-")).join("|"));

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
