'use strict';

// **WRITING AN AGENT'S NAME OR DESCRIPTION, AND TELLING THE REST OF THE WORLD** (Samuel's
// report, 2026-09-05: *"I rename an agent and the @-picker still offers the old name"*).
//
// ⚠ THE BUG THIS FILE EXISTS FOR. `agent-names.js` is a LOCAL electron-store. The @-picker is
// not local — since the B10 slice it reads the SERVER's peer projection
// (`channel_sessions.display_name`, polled by `use-agents-panel.ts`). The name crosses that gap
// exactly once: `session-state-push.js › reportRow` carries the summary's `displayName`, and the
// push only fires when the summary DIGEST moves. A rename moves the store, not the digest — and
// no rename caller asked the summary to re-read itself. So the new name sat on the machine until
// some UNRELATED engine event happened to flush, which on a quiet machine is never: the operator
// renames an agent, nothing else happens because nothing else is running, and the picker offers
// the old name until the app is restarted and every session re-registers.
//
// ⚠ WHY A WRAPPER AND NOT A LINE IN EACH CALLER. There are THREE rename paths — the IPC op
// (`session-ipc-ops.js › sessions:rename`), the in-process tool (`runtime/claude/axis-b.js ›
// applyRename`) and the external directive (`directive-agent-ops.js`) — and this bug is what a
// missing line in ONE of them looks like. Three call sites that must each remember a follow-up
// call is the same shape as the defect. One function, and the follow-up is not forgettable.
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
 * ── ⚠ AND IT IS WHERE THE UNIQUENESS RULE IS ENFORCED (Samuel, 2026-09-15) ──────────────────
 *
 * *"I think we should enforce a rule where no two agents that are addressable can have the same
 * name … it will automatically auto-resolve to coder-1 … coder-2 and so on."*
 *
 * ⚠ **HERE, BECAUSE THIS IS ALREADY THE ONE DOOR ALL THREE RENAME PATHS GO THROUGH** — the IPC op
 * (`session-ipc-ops.js › sessions:rename`, which the SPA's launch dialog and the Agents-tab
 * pencil both reach), the in-process tool (`runtime/claude/axis-b.js › applyRename`) and the
 * external directive (`directive-agent-ops.js`). This module's own header states why that door
 * exists: three call sites that must each remember a follow-up is the same shape as the defect.
 * The LAUNCH lanes reach it too — `launch-directive-spawn.js` commits the directive's name, and
 * the SPA renames straight after its launch — so "every launch path" and "the rename path" are
 * one place rather than five.
 *
 * ⚠ **THE SUFFIX IS APPLIED TO WHAT IS STORED, AND THE ANSWER CARRIES IT BACK.** `res.name` is
 * main's own value and always was (the never-echo-the-ask rule `rename`/`setMode`/`setModel`
 * share), so a caller that renders it already shows `coder-1` with no change — which is how the
 * launcher learns the final name.
 *
 * ⚠ **THE RULE RUNS BEFORE THE SANITIZER, NOT AFTER**, because `sanitizeName` is what decides
 * whether the string is storable at all: suffixing a name that is about to be REFUSED would make
 * the refusal about a string nobody sent. `applyRenameTo` still owns both the clear gesture and
 * the refusal, unchanged.
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
      unique.addressableSiblings(rows, agentId, channelOf(rows, agentId))
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
