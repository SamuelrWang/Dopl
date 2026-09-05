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
 * exactly as visible to a peer as setting one — the card goes back to `#<id>`. Gating the touch
 * on a non-empty name is the bug in miniature, so the gate is `res.ok`, never `res.name`.
 *
 * @returns `agent-self-ops.js › applyRenameTo`'s own verdict, untouched — callers already answer
 * in their own shapes and this must not become a second vocabulary.
 */
function commitRename(agentId, value) {
  const res = require('./agent-self-ops').applyRenameTo(
    require('./agent-names'),
    agentId,
    value
  );
  if (res && res.ok) require('./session-summary').touch();
  return res;
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
