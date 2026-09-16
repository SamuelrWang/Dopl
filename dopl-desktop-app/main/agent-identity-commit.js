'use strict';

// **WRITING AN AGENT'S NAME OR DESCRIPTION, AND TELLING THE REST OF THE WORLD** (Samuel's
// report, 2026-09-05: *"I rename an agent and the @-picker still offers the old name"*).
//
// 🔒 **A NAME THAT NEVER REACHES THE PROJECTION IS A NAME NO PEER HAS.** `agent-names.js` is a
// LOCAL electron-store; the @-picker reads the SERVER's `channel_sessions.display_name`, and the
// name crosses that gap only when `session-state-push.js` fires — which is when the summary
// DIGEST moves. A rename moves the store, not the digest, so without the `touch()` below the new
// name sits on the machine until some unrelated engine event flushes, i.e. on a quiet machine
// never.
//
// ⚠ WHY A WRAPPER AND NOT A LINE IN EACH CALLER: there are THREE rename paths
// (`session-ipc-ops.js › sessions:rename`, `runtime/claude/axis-b.js › applyRename`,
// `directive-agent-ops.js`), and this bug is what a missing line in ONE of them looks like.
//
// ⚠ AND WHY NOT IN `agent-self-ops.js`. That module's core is deliberately PURE and
// electron-free, with `names` injected, so `test/agent-self-ops.test.mjs` evaluates it verbatim.
// A `session-summary` require in there would drag the store and the push into a unit test that
// exists precisely to have neither. The seam is: that file decides WHAT the write is, this one
// commits it and announces it.
//
// ⚠ THE REQUIRES ARE LAZY, matching `session-ipc-ops.js`'s own idiom in this tree: these modules
// form a cycle at load time, and a top-level require here is how that cycle bites.

/**
 * Rename one agent, then make the world able to see it.
 *
 * ⚠ THE TOUCH IS ON SUCCESS ONLY. A refused rename (a sanitizer refusal) changed nothing, and
 * pushing an unchanged projection is a write to every peer's poll for no reason.
 * ⚠ A CLEAR IS A CHANGE TOO. `applyRenameTo` treats an empty value as "clear the name", which is
 * exactly as visible to a peer as setting one — the card goes back to the unnamed face. Gating
 * the touch on a non-empty name is the bug in miniature, so the gate is `res.ok`, never
 * `res.name`.
 *
 * ── ⚠ AND IT IS WHERE THE UNIQUENESS RULE IS ENFORCED (Samuel, 2026-09-15: *"no two agents that
 * are addressable can have the same name … it will automatically auto-resolve to coder-1 …
 * coder-2"*) ─────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠ **HERE, BECAUSE THIS IS ALREADY THE ONE DOOR EVERY RENAME AND EVERY LAUNCH LANE GOES
 * THROUGH** — the IPC op, the in-process tool, the external directive, and both launch lanes
 * (`launch-directive-spawn.js` commits the directive's name; the SPA renames straight after its
 * launch). One place rather than five.
 *
 * ⚠ **THE SUFFIX IS APPLIED TO WHAT IS STORED, AND THE ANSWER CARRIES IT BACK.** `res.name` is
 * main's OWN value (the never-echo-the-ask rule), so a caller that renders it already shows
 * `coder-1` — which is how the launcher learns the final name.
 *
 * ⚠ **THE RULE RUNS BEFORE THE SANITIZER, NOT AFTER**: suffixing a name that is about to be
 * REFUSED would make the refusal about a string nobody sent. `applyRenameTo` still owns both the
 * clear gesture and the refusal.
 *
 * @returns `agent-self-ops.js › applyRenameTo`'s own verdict, untouched — callers already answer
 * in their own shapes and this must not become a second vocabulary.
 */
function commitRename(agentId, value) {
  const res = require('./agent-self-ops').applyRenameTo(
    require('./agent-names'),
    agentId,
    uniqueFor(agentId, value)
  );
  if (res && res.ok) require('./session-summary').touch();
  return res;
}

/**
 * {@link commitRename}'s live half: the name `value` should actually be stored under, given who
 * else is addressable in THIS agent's channel.
 *
 * ⚠ **THE PROJECTION IS THE ROSTER, AND IT IS THE ONE THIS MACHINE ALREADY PUSHES.**
 * `session-summary.js › reportList` carries `agentId`, `channelId`, `state` and `displayName` per
 * row — every fact the rule reads — so there is no second registry walk and no new source of
 * truth about who is running.
 *
 * ⚠ **IT NEVER THROWS AND NEVER BLOCKS A RENAME.** A naming rule may not be the thing that fails
 * a launch. Where the projection cannot be read, the wanted name is stored as asked: two agents
 * sharing a tag is a resolvable annoyance, a spawn that did not happen is not.
 *
 * ⚠ **A PEER'S AGENTS ARE NOT IN IT, AND THAT IS HONEST RATHER THAN A HOLE.** Names live on the
 * machine that minted the id (`agent-names.js`'s header), so this machine can only make its OWN
 * agents unique. Two members can still each run a "Coder" in one room — the same limit every
 * local naming rule in this tree has, and the resolver answers it by naming the first claimant.
 */
function uniqueFor(agentId, value) {
  try {
    const unique = require('./agent-name-unique');
    const rows = require('./session-summary').reportList();
    return unique.uniqueAgentName(
      value,
      unique.addressableSiblings(rows, agentId, channelOf(rows, agentId)),
      // ⚠ THE STORE'S OWN CAP, HANDED DOWN RATHER THAN RE-TYPED. `sanitizeName` REFUSES a name
      // over it, so a 60-character name that collided would be suffixed to 62 and refused —
      // nameless agent on the launch lane, `bad-name` on the rename lane.
      require('./agent-names').MAX_NAME
    );
  } catch (err) {
    try {
      require('./diag').diag('agent-identity-commit: uniqueness check skipped —', err && err.message);
    } catch (_) {
      /* no diag sink reachable — storing the wanted name is the documented answer */
    }
    return value;
  }
}

/** Which channel this agent is in, off the same projection. ⚠ `''` WHEN THE AGENT IS NOT IN IT —
 *  a rename arriving before the first push, or for an id this machine does not run — and that
 *  answer makes {@link uniqueFor} compare against the channel-less rows only, i.e. against
 *  nothing, which is the same fail-open direction the catch above takes. */
function channelOf(rows, agentId) {
  const id = String(agentId || '');
  for (const row of rows || []) {
    if (String((row && row.agentId) || '') === id) return String(row.channelId || '');
  }
  return '';
}

/**
 * Describe one agent, then the same announcement.
 *
 * ⚠ IT HAS THE SAME MISSING FLUSH AND FOR THE SAME REASON — `sessions:describe` is rename's twin
 * and wrote the store without telling the summary either. The description does NOT cross to peers
 * (`channel_sessions` carries no such column, deliberately — see `agents-tab-cards.tsx`), but it
 * DOES ride the local summary onto this operator's own cards, so a describe that never flushed
 * left the agent's own card stale on the machine that set it.
 *
 * @returns `agent-names.js › describe`'s stored value, or `null` for a refusal.
 */
function commitDescribe(agentId, value) {
  const stored = require('./agent-names').describe(agentId, value);
  if (stored !== null) require('./session-summary').touch();
  return stored;
}

module.exports = { commitRename, commitDescribe };
