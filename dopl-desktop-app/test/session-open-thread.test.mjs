// Q6b — the CHANNEL CONTEXT a thread this machine holds no record of can still contribute.
//
// WHAT THIS FILE WAS. Three layers of "Open session ALWAYS opens a window, even for a thread
// this machine has no record of": (1) PURE — `channel-context.contextFromChannel`, the DTO
// reader; (2) SHELL — session-park's record-less branch, which opened a parked window seeded
// from the channel; (3) VERDICT — the `{ok,reason}` shape session-reopen returned for the web
// card to word.
//
// ⚠ LAYERS 2 AND 3 ARE DELETED — 2026-08-20, F-228. Both drove `openFromChannel` /
// `recreateParkedShell`, whose single job was to MINT A SESSION WINDOW; `main/session-window.js`
// and the whole `renderer/session/**` tree are gone, so there is no window to open, no replay
// ring to seed from history (`session-history.js` went too), and no `resolveChannelContext`
// handle on session-park's bind(). `reopenByTask` now has exactly two answers — a LIVE session
// opens `main/agent-window.js`, anything else is `{ok:false, reason:'no-session'}` — and that
// contract is pinned by test/session-reopen.test.mjs, not from here.
//
// ⚠ LAYER 1 IS UNTOUCHED AND IS WHY THIS FILE STILL EXISTS. `contextFromChannel` is live, it is
// the ONLY thing that tests it anywhere in the tree, and its rules are security rules rather
// than window rules: a channel the caller is not a member of yields NOTHING, a group channel
// yields NO counterparty, and `direct` is set only by the server's own `true`. Deleting the file
// with the lane it happened to be documented under would have taken all three with it
// (INVARIANTS §14).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const channelContext = require(join(HERE, "..", "main", "channel-context.js"));

// ── PURE: the channel context ────────────────────────────────────────────────

const direct = {
  id: "chan-1", name: "David", isDirect: true, isMember: true,
  directPeer: { userId: "user-peer", displayName: "David", avatarUrl: null },
};

test("a DIRECT channel yields the workspace, the name and the server-resolved peer", () => {
  const ctx = channelContext.contextFromChannel(direct, "ws-1", "acme-ab12");
  assert.deepEqual(ctx, {
    channelId: "chan-1", workspaceId: "ws-1", workspaceSegment: "acme-ab12",
    channelName: "David", counterpartyId: "user-peer", counterpartyName: "David",
    // H2: the server's own 1:1 flag, carried SEPARATELY from the peer it resolved. A session
    // needs it to know that its unaddressed posts are addressed for it (resolveDirectPeer),
    // which is what the outbound approval card names a recipient from — the card is a consent
    // ROW on the channels surface now (session-windowless.js › bridgeOutbound), and it reads
    // the same flag off the same context.
    direct: true,
  });
});

test("a GROUP channel yields NO counterparty — nothing downstream ever guesses one", () => {
  const group = { id: "chan-1", name: "Ops", isDirect: false, isMember: true, directPeer: null, memberCount: 5 };
  const ctx = channelContext.contextFromChannel(group, "ws-1", null);
  // FIX N1: the null is still a null (no peer is ever inferred). What it costs downstream is
  // no longer a window with nothing in it — it is the FIX L1 binding staying unset, which is
  // the fail-restrictive direction.
  assert.equal(ctx.counterpartyId, null, "no member of a group channel is promoted to 'them'");
  assert.equal(ctx.counterpartyName, null);
  // A direct flag with no resolved peer is equally not a counterparty.
  assert.equal(channelContext.contextFromChannel({ ...direct, directPeer: {} }, "ws-1").counterpartyId, null);
  assert.equal(channelContext.contextFromChannel({ ...direct, isDirect: false }, "ws-1").counterpartyId, null);
  // H2: a group channel is NOT direct, so nothing downstream may name a recipient for an
  // unaddressed post there. The flag is strict — only the server's own `true` sets it.
  assert.equal(ctx.direct, false);
  for (const junk of [undefined, null, "true", 1]) {
    assert.equal(channelContext.contextFromChannel({ ...direct, isDirect: junk }, "ws-1").direct, false, JSON.stringify(junk));
  }
});

test("a channel the caller is not a member of, or with no workspace, yields NOTHING", () => {
  assert.equal(channelContext.contextFromChannel({ ...direct, isMember: false }, "ws-1"), null);
  assert.equal(channelContext.contextFromChannel(direct, ""), null);
  assert.equal(channelContext.contextFromChannel(null, "ws-1"), null);
  assert.equal(channelContext.contextFromChannel({}, "ws-1"), null);
});

// ⚠ THE §2 SHELL BLOCK STOOD HERE — eight tests plus their `harness()`, all driving
// `recreateParkedShell({..., fromChannel: true})`. What they pinned:
//   · no durable record + an operator CLICK opened a shell seeded from the channel, FAIL
//     RESTRICTIVE at `read_only` and `side: 'requester'`;
//   · the history it loaded was TASK-SCOPED, on the same shell;
//   · opening started NO agent work (no query, no consumer, no lifecycle, zero counters);
//   · a channel the operator cannot open answered `{ok:false, reason:'no-thread'}`;
//   · the shared WINDOW budget refused a reopen storm, checked BEFORE the network read;
//   · one shell per (channel, thread);
//   · a mid-wave engine with no resolver failed CLOSED;
//   · ⚠ THE INBOUND GATE COULD NEVER OPEN A RECORD-LESS SHELL — only a click, via `fromChannel`.
//
// The last one was the security rule of the set, and it is now structural rather than tested:
// `session-gate.js` no longer HAS a recreate call site (`feedInboundForTask`, `decideInbound`,
// `drainQueue` and `drainInbound` were deleted with the hold surface), and a windowless
// session's message axis is floored at `auto_inbound`, so an inbound never holds and never asks
// for a surface. There is no `fromChannel` flag left to forget.

// ⚠ THE §3 VERDICT TEST STOOD HERE. It grepped session-reopen.js for the
// `recreateParkedShell({ channelId, taskId, fromChannel: true })` call site and for the three
// verdict strings the web card words (`{ ok: true }`, `reason: 'no-thread'`, `reason: 'busy'`).
// Two of those three verdicts no longer exist: there is no thread-less open to refuse and no
// window budget to be busy against. `reopenByTask`'s live contract — live session -> agent
// window, everything else -> `{ok:false, reason:'no-session'}` — belongs to session-reopen's own
// suite, which drives the function instead of grepping its call site.
