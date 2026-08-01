/**
 * THE TWO-AGENT THREAD HANDSHAKE KEY — the client half of a contract whose
 * server half is `src/features/channels/server/service-thread-handshake.ts`.
 *
 * THE BUG THIS MODULE EXISTS FOR (BLOCKER-1). THE LAW tells an agent to open
 * the shared thread with `client_msg_id="thread-open-<channelId>-<seq>"`. The
 * `channel` param, one line of schema away, accepts a SLUG **or** an id. So an
 * agent that has only ever held a slug — `op="list"` renders both, and the slug
 * is the readable one — builds `thread-open-general-42`, which is exactly what
 * the instructions say and is silently wrong:
 *
 *   `parseHandshakeSeq` anchors on the channel UUID → null
 *   → `deriveHandshakeParticipants` → `[]`
 *   → `createTask` seeds NO participant rows and returns 200
 *   → the thread keeps the ordinary creator/target PAIR gate
 *   → the OTHER addressed agent finds the thread, posts into it, and is 403'd
 *     by `mayWriteThread`.
 *
 * That is precisely the "told to join a room, locked out of it" failure the
 * server module was written to prevent, reached by following the instructions.
 * Every step of it is silent: the create succeeds, and the only symptom lands on
 * the OTHER machine, one turn later, as an authorization error about a thread it
 * was told to use.
 *
 * THE TEETH: REWRITE, NOT REFUSE — for the shape that can be repaired.
 * `opCreateThread` has already resolved slug-or-id to a `Channel` row, so it
 * KNOWS the uuid the server will anchor on; declining to use it and 400-ing the
 * caller instead would be withholding an answer we hold. Two further reasons,
 * and the second is the one that decides it:
 *
 *  1. The key is not a caller-meaningful name. It is a derived idempotency
 *     token whose entire job is that two agents mint the SAME string; nothing
 *     reads it back, nothing displays it, and the protocol specifies its bytes.
 *     Normalizing a derived token is not overwriting the caller's intent, it is
 *     computing the token the caller was trying to compute.
 *  2. REFUSING WOULD NOT ACTUALLY FIX THE RACE, and rewriting does. When one
 *     agent passes the slug form and the other passes the uuid form, the two
 *     keys DIFFER, the partial unique index on `(channel_id, client_msg_id)`
 *     sees two distinct values, and the operator gets TWO THREADS for one
 *     instruction — the failure the handshake exists to prevent, in its other
 *     shape. Rewriting collapses both forms onto one key, so the race converges
 *     even when the two agents disagree about how to name the channel. A
 *     refusal only converges them if BOTH agents read the error and both retry.
 *
 * WHAT IS STILL REFUSED: a `thread-open-` key with no `<seq>` tail. There is
 * nothing to repair there — the seq names the triggering message and this
 * package cannot invent it — and leaving it alone would re-open the silent miss
 * this module closes. The refusal names the shape and where the seq comes from.
 *
 * WHY NOT WIDEN `parseHandshakeSeq` TO ACCEPT THE SLUG instead. It would have
 * to resolve a slug to a channel to compare it, turning a pure string parse into
 * a DB read on the create path; slugs are mutable and case-folded where the id
 * is neither, so two agents could still mint two keys for one channel; and the
 * server would be accepting a key minted for a channel it cannot prove is this
 * one — the pinning that stops a cross-channel key deriving anything here. The
 * fix belongs where the ambiguity is introduced, which is the tool that accepts
 * both forms.
 *
 * SCOPE: `create_thread` only. `client_msg_id` on `post` is plain idempotency —
 * nothing derives a participant set from it — so a post's key is the caller's
 * and is passed through untouched.
 */

/** The prefix the protocol's derived key starts with. Mirrors `HANDSHAKE_PREFIX`. */
export const HANDSHAKE_PREFIX = "thread-open-";

/**
 * The trailing `-<seq>`. Greedy on the middle, because a channel id is a UUID
 * and contains hyphens itself — the seq is the LAST hyphen-separated run of
 * digits, which is the same anchoring `parseHandshakeSeq` gets for free from
 * knowing the id.
 */
const SEQ_TAIL = /^(.+)-(\d+)$/;

/** What {@link normalizeHandshakeKey} decided about a caller's key. */
export type HandshakeKey =
  /** Not a handshake key at all — pass the caller's value through untouched. */
  | { status: "passthrough" }
  /** A handshake key, in canonical form. `rewritten` when we changed it. */
  | { status: "ok"; key: string; seq: number; rewritten: boolean }
  /** A handshake key with no usable `<seq>` — nothing here can repair it. */
  | { status: "malformed" };

/**
 * Canonicalize a `create_thread` idempotency key against the RESOLVED channel.
 *
 * Fails closed in the direction that cannot break anything: a key that is not
 * the handshake shape is `passthrough` and is never touched, so every ordinary
 * idempotency key behaves byte for byte as it did.
 */
export function normalizeHandshakeKey(
  clientMsgId: string | undefined,
  channelId: string,
): HandshakeKey {
  if (!clientMsgId || !clientMsgId.startsWith(HANDSHAKE_PREFIX)) {
    return { status: "passthrough" };
  }
  const rest = clientMsgId.slice(HANDSHAKE_PREFIX.length);
  const match = SEQ_TAIL.exec(rest);
  if (!match) return { status: "malformed" };
  const seq = Number(match[2]);
  // The same bounds `parseHandshakeSeq` enforces: `seq` is a 1-based identity
  // column, and a digit run long enough to lose integer precision names no row.
  // A key we "repaired" into one of those would derive nothing on the server
  // and be a silent miss wearing a canonical shape.
  if (seq < 1 || !Number.isSafeInteger(seq)) return { status: "malformed" };
  const key = `${HANDSHAKE_PREFIX}${channelId}-${seq}`;
  return { status: "ok", key, seq, rewritten: key !== clientMsgId };
}

/**
 * The refusal for a `thread-open-` key with no seq. It names the ONE thing the
 * caller has to supply — the seq of the message that asked — because that is
 * the half this package cannot derive, and it states the channel id outright so
 * the retry does not have to go looking for it.
 */
export function malformedHandshakeKey(
  clientMsgId: string,
  channelId: string,
): string {
  return `That \`client_msg_id\` starts with "${HANDSHAKE_PREFIX}" but is not a handshake key — no thread was opened. The form is client_msg_id="${HANDSHAKE_PREFIX}<channelId>-<seq>", and the \`<seq>\` is the seq of the MESSAGE THAT ASKED for this work, as shown on its line in "read" / "await" (\`**#42**\` means seq 42). Yours ends in no seq at all, so two agents racing to open this thread would mint two different keys and you would get two rooms for one job. Re-send it as client_msg_id="${HANDSHAKE_PREFIX}${channelId}-<that seq>". If this thread has nothing to do with a two-agent handshake, use any other idempotency key — the "${HANDSHAKE_PREFIX}" prefix is reserved for it.`;
}

/**
 * The note a rewritten key carries back, so the agent learns the canonical form
 * instead of minting the same wrong one next turn.
 *
 * It says WHAT WOULD HAVE HAPPENED, not just what changed: "we normalized your
 * key" is not actionable, where "the other agent would have been locked out of
 * this thread" is the fact that makes the correction stick.
 */
export function rewrittenHandshakeKeyNote(
  supplied: string,
  key: string,
): string {
  return `HANDSHAKE KEY REWRITTEN: you passed client_msg_id="${supplied}", and this thread was opened with "${key}" instead. The key MUST carry the channel's UUID — the server anchors on it, and a key built from the SLUG parses as no handshake at all: the thread would have been created with no participant set, and the other addressed agent would have been 403'd out of the room it was told to join. Same seq, same idempotency: an agent that raced you with the correct form converged on this same thread. Use the id form from here on — client_msg_id="${key}".`;
}
