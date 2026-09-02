// DELIVERY RECEIPTS — what THIS machine did with a message, held until the next
// session-state push carries them (2026-09-02, v2 wave A slice A9).
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────────────────────
//
// ⚠ AN `@agent-<id>` USED TO BE A WAKE THE SERVER COULD NOT CONFIRM. The token is parsed
// HERE, by `session-dispatch.js › feedLiveSession`, and nothing crossed back — so an
// orchestrator that redirected an agent could not tell "it landed and the agent is on it"
// from "it landed on nobody", and those two need opposite next actions. `session-gate.js`
// already stamps `lastWakeSeq` / `lastWakeAt` on the SESSION, which answers "was this agent
// woken lately"; it cannot answer "what happened to MY message", because a session row is
// not per-message and a message may reach several sessions or none.
//
// ── WHY IT IS A BUFFER AND NOT A POST ─────────────────────────────────────────────────────
//
// ⚠ THE ACK RIDES `session-state-push.js`, AND IT CANNOT POST ON ITS OWN. That endpoint is a
// WHOLE-SET REPLACE: `{ sessions: [] }` is a real instruction that deletes this machine's
// rows. A module posting receipts with an empty session list would wipe the projection every
// time it spoke. So this holds them and the writer drains them into the payload it was going
// to send anyway — one credential path, one retry policy, one thing to keep alive.
//
// ⚠ AND PENDING RECEIPTS FORCE A PUSH THE DIGEST GATE WOULD HAVE SKIPPED. In practice almost
// every receipt coincides with a state change (a wake moves a session out of dormant, a fed
// turn moves `turns`), but "almost" is not a contract for a field an orchestrator polls.
//
// ── WHAT IT IS NOT ────────────────────────────────────────────────────────────────────────
//
// ⚠ EVERY RECEIPT CARRIES THE IDENTITY THAT EARNED IT, and {@link take} hands back only the
// caller's own. Signing out does not end engine sessions, so operator A's dispatch can file a
// receipt that is still buffered when operator B signs in on the same Mac — and posting it
// under B's credential would attribute A's delivery to B. This is `session-state-push.js ›
// trackOrigin`'s rule for the ROWS, applied to the claims about them, and it is a STAMP rather
// than a clear-on-handover because a clear has to be triggered by something that notices.
//
// ⚠ NOT DURABLE. Receipts live in memory and are lost on quit, exactly like the cursor's
// in-flight state. A lost receipt reads as "not acknowledged", which is the server's own
// resting answer (`channel_messages.delivery_at IS NULL`) and is the honest one — inventing
// persistence for it would mean replaying stale claims about turns that are long over.
//
// PURE below the sentinel — no require, no clock, no store, no network — so its suite
// evaluates it verbatim and `session-dispatch.js` / `session-state-push.js` can both hold it
// without dragging anything in.

// ─── BEGIN DELIVERY-ACK-PURE (pure; unit-tested via source extraction) ────────────────────

// ⚠ THE SAME FOUR WORDS THE SERVER ACCEPTS FROM A MACHINE
// (`src/features/channels/types.ts › MachineDelivery`, restated as the zod enum in
// `schema-sessions.ts › DeliveryAckSchema`). The server's full vocabulary has two more —
// `none` and `unreachable` — and they are ITS answers about a message it resolved: a delivery
// attempt does not observe "nobody was addressed". Sending one would 400 the whole push.
//
// ⚠ THE ORDER IS THE RANK AND IT IS THE SERVER'S
// (`server/service-writes-delivery.ts › DELIVERY_RANK`), ascending. It answers "how far did
// this message get", which is the question an orchestrator asks — not a severity scale. Two
// receipts for one message converge on the strongest, here and again server-side, because
// several sessions of one machine can disagree and several MACHINES can too.
const DELIVERY_RANK = ['refused', 'idle', 'delivered', 'woken'];

// ⚠ PER WORKSPACE, AND THE BOUND IS THE SERVER'S ARRAY MAX
// (`schema-sessions.ts › DELIVERY_ACK_MAX`). Zod validates the ARRAY, so an oversized list
// 400s the WHOLE push — sessions included — and `retryable(400)` is false, which strands the
// projection every later cycle too. The session set is what a whole tool reads; a receipt is
// a convenience beside it and loses the tie.
const MAX_PENDING = 32;

// workspaceId -> Map<`${channelId}:${seq}`, { channelId, seq, delivery, userId }>
// ⚠ KEYED SO ONE MESSAGE HOLDS ONE RECEIPT. Without the key a busy thread would queue one
// entry per session it touched, all about the same message, and the bound would evict real
// news to make room for repetitions of one fact.
const pending = new Map();

function rankOf(delivery) {
  return DELIVERY_RANK.indexOf(delivery);
}

/**
 * RECORD WHAT THIS MACHINE DID WITH ONE MESSAGE.
 *
 * ⚠ IT ONLY EVER STRENGTHENS. `session-dispatch.js` reports once per message, but this module
 * is the entry point and a second caller must not be able to downgrade a wake to a refusal by
 * speaking later. Same rule as the server's `WHERE`, stated on both sides because neither can
 * see the other's ordering.
 *
 * ⚠ AN UNKNOWN WORD IS DROPPED, NOT PASSED THROUGH. It would 400 the whole push, and a
 * receipt is never worth the projection.
 */
function note(workspaceId, channelId, seq, delivery, userId) {
  const ws = String(workspaceId || '');
  const chan = String(channelId || '');
  const who = String(userId || '');
  // ⚠ AN UNIDENTIFIED RECEIPT IS DROPPED. `take` fences on identity, so one filed without it
  // could never be handed back — and a buffer that silently keeps what it can never emit is
  // the eviction bound spent on nothing.
  if (!ws || !chan || !who) return false;
  if (!Number.isFinite(Number(seq)) || Number(seq) <= 0) return false;
  if (rankOf(delivery) === -1) return false;

  let box = pending.get(ws);
  if (!box) { box = new Map(); pending.set(ws, box); }
  const key = chan + ':' + Number(seq);
  const held = box.get(key);
  if (held && held.userId === who && rankOf(held.delivery) >= rankOf(delivery)) return false;
  box.delete(key); // re-insert so the eviction below drops the OLDEST news, not the newest
  box.set(key, { channelId: chan, seq: Number(seq), delivery: delivery, userId: who });
  // ⚠ EVICT THE OLDEST. A Map preserves insertion order, and the receipts an orchestrator is
  // waiting on are the ones that just happened — a bound that dropped the NEWEST would make
  // this module quietest exactly when the machine is busiest.
  while (box.size > MAX_PENDING) box.delete(box.keys().next().value);
  return true;
}

/** Every workspace holding receipts THIS operator filed — so the writer pushes for a workspace
 *  whose session set did not move at all. */
function pendingWorkspaces(userId) {
  const who = String(userId || '');
  if (!who) return [];
  return [...pending.keys()].filter((ws) => mine(ws, who).length > 0);
}

function mine(ws, who) {
  return [...(pending.get(ws) || new Map()).values()].filter((a) => a.userId === who);
}

/**
 * Take one workspace's receipts for ONE operator.
 *
 * ⚠ REMOVES them: the caller owns them from here and must {@link restore} them if the send
 * fails, exactly like the digest it declines to record.
 * ⚠ ANOTHER OPERATOR'S ARE LEFT WHERE THEY ARE, not deleted — this machine may still be
 * signed back in as them, and dropping a receipt is dropping a claim nothing will ever repeat.
 * The eviction bound is what stops an abandoned identity's receipts accumulating.
 */
function take(workspaceId, userId) {
  const ws = String(workspaceId || '');
  const who = String(userId || '');
  const box = pending.get(ws);
  if (!who || !box || box.size === 0) return [];
  const out = [];
  for (const [key, a] of [...box]) {
    if (a.userId !== who) continue;
    out.push({ channelId: a.channelId, seq: a.seq, delivery: a.delivery });
    box.delete(key);
  }
  if (box.size === 0) pending.delete(ws);
  return out;
}

/** Put receipts back after a failed send, without clobbering anything stronger that arrived
 *  while the POST was in flight — which is why this goes through {@link note}. */
function restore(workspaceId, acks, userId) {
  for (const a of acks || []) note(workspaceId, a.channelId, a.seq, a.delivery, userId);
}

/** Drop everything. ⚠ FOR A SUITE, which is the only caller: this is module state, and a case
 *  that inherited the previous one's receipts would assert about a machine it never drove. The
 *  cross-account rule is the identity stamp on every receipt, not a clear — a clear has to be
 *  triggered by something that notices, and the stamp is true whether anything noticed or not. */
function reset() {
  pending.clear();
}

// ─── END DELIVERY-ACK-PURE ────────────────────────────────────────────────────────────────

module.exports = { note, pendingWorkspaces, take, restore, reset, MAX_PENDING, DELIVERY_RANK };
