import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { MAX_ADDRESSED_AGENTS } from "../schema";
import type { ThreadParticipantRef } from "../schema";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import { identityBelongs } from "./service-participants";

/**
 * THE TWO-AGENT THREAD HANDSHAKE — the server half.
 *
 * ONE human message can address TWO agents ("@quartz @onyx work together on
 * X"). Both machines wake, both run an agent, and both are equally able to call
 * `create_thread`. The operator must never end up with two threads for one
 * instruction, and both agents must be able to write into the one thread that
 * does get opened.
 *
 * The MCP lane teaches agents a protocol for this — exactly one opens (the
 * addressed agent whose AGENT ID sorts lexicographically first), it passes
 * `client_msg_id` of the form `thread-open-<channelId>-<seq>` where `seq` is the
 * triggering message's, and the others wait for that thread and post into it.
 * THIS MODULE ASSUMES THE PROTOCOL IS IGNORED. A rule an agent has to remember
 * is a rule that will be broken by the third model that reads it, so the server
 * is what has to hold:
 *
 *  - **One thread** is `createTask`'s existing `client_msg_id` envelope: the
 *    partial unique index on `(channel_id, client_msg_id)` means the second
 *    create converges on the first one's row instead of inserting a second.
 *    That was already true; what this module adds is the rest.
 *  - **A room both agents can write into.** A thread's write gate is the
 *    creator/target PAIR until the thread has a participant set
 *    (`service-writes-metadata.ts`). Whichever agent lost the race is neither
 *    the creator nor the target, so without a set it converges on a thread it is
 *    then 403'd out of — told to join a room and locked out of it. It cannot
 *    fix that itself either: the CURATION RULE (`service-participants.ts`)
 *    correctly refuses a stranger's self-join, and widening THAT to rescue this
 *    case would re-open the escalation it exists to close.
 *
 * SO THE SET IS DERIVED, SERVER-SIDE, FROM THE ADDRESSING. When the create's
 * `client_msg_id` has the handshake shape, it names a `seq` in THIS channel; the
 * message at that seq is the human's instruction, and its `metadata.to_agent_ids`
 * is the list of agents the server itself resolved when that message was posted.
 * The derived set is: every addressed agent, every addressed agent's OWNER, and
 * the human who sent the instruction — plus the thread's creator and target,
 * which `seedThreadParticipants` adds for every seeded thread.
 *
 * WHY DERIVE RATHER THAN LET THE OPENER PASS `participants`:
 *  - The opener passing them is one more thing an agent can forget, and the
 *    failure mode of forgetting is invisible until the OTHER agent tries to post
 *    — which is the failure this whole module exists to remove.
 *  - The LOSER of the race never reaches the seeding branch at all (it returns
 *    on the short-circuit), so a caller-supplied set cannot repair a winner that
 *    crashed between the insert and the seed. A derived set can: both callers
 *    carry the same `client_msg_id`, so both derive the SAME set, and seeding is
 *    idempotent.
 *  - It cannot be forged. `to_agent_ids` is a RESERVED metadata key — stripped
 *    from caller metadata unconditionally and re-stamped only from the validated
 *    `toAgent` / `toAgents` fields, every entry of which has already been
 *    resolved to an agent OF THIS CHANNEL whose owner is an active member
 *    (`service-writes-agents.ts`). So the derived identities are exactly the
 *    ones the server itself addressed, not ones a caller named.
 *
 * `participants` on the create is UNCHANGED and still works — the two compose,
 * and a create with no handshake key derives nothing and behaves byte for byte
 * as it did.
 *
 * WHY THIS IS NOT A CURATION BYPASS. It is a seed at CREATE time, on the thread
 * the call created or converged on, never a widening of the join route. A caller
 * converging on someone else's thread can only ever seed the set that thread's
 * OWN `client_msg_id` derives — the same set the winner's call derives — so it
 * adds nothing that was not already going to be there, and it cannot add
 * ITSELF: a caller that is not the instruction's author and owns none of the
 * addressed agents is not in the derived set at all.
 *
 * EVERY MISS IS SILENT AND SEEDS NOTHING. A key that is not the handshake shape,
 * a seq with no message, a message that addressed no agents, an agent since
 * deleted, an owner who has left the channel — each drops out and the thread
 * keeps the ordinary pair gate. Seeding fewer identities is always the SAFE
 * direction (a smaller set is a narrower gate), and a `client_msg_id` is
 * caller-supplied and unverifiable, so it must never be able to make a create
 * fail.
 */

/** The prefix the MCP lane's derived key starts with (see the module docblock). */
const HANDSHAKE_PREFIX = "thread-open-";

/**
 * How many addressed agents one derivation will seed from. Bounded rather than
 * trusting the stored array's length: this reads a jsonb column, and a row
 * written by a future (or a tampered-with) path must not turn one create into
 * an unbounded insert loop.
 *
 * IT IS THE POST SCHEMA'S OWN BOUND, imported rather than restated. It was a
 * literal `8` beside a `MAX_ADDRESSED_AGENTS` of 8, which held only while the
 * two numbers happened to agree — and they did not: the post path capped
 * `toAgents` alone, so `toAgent` + eight made NINE addressed agents and this
 * TRUNCATED the ninth. That agent was engaged and woken by the address, then
 * converged on the handshake thread and was 403'd out of it by `mayWriteThread`
 * — told to join a room and locked out of it, which is the one failure this
 * module exists to prevent. The merged cap now holds at the post
 * (`service-writes-agents.ts`), and this reads the same constant so a future
 * change to it cannot re-open the gap.
 */
const MAX_DERIVED_AGENTS = MAX_ADDRESSED_AGENTS;

/**
 * The `seq` named by a handshake `client_msg_id`, or null for every other key.
 *
 * Anchored on the KNOWN channel id rather than split on '-', because a channel
 * id is a UUID and contains hyphens itself — the same reason
 * `parseLegacyTaskSeq` (`lib/group-thread.ts`) is written this way. Pinning the
 * channel id also means a key minted for ANOTHER channel derives nothing here.
 *
 * Fails closed on every shape that is not exactly the protocol's: a foreign
 * prefix, a non-digit tail, a seq below 1 (the column is a 1-based identity),
 * or a digit run long enough to lose integer precision.
 */
export function parseHandshakeSeq(
  clientMsgId: string | null | undefined,
  channelId: string
): number | null {
  if (!clientMsgId) return null;
  const prefix = `${HANDSHAKE_PREFIX}${channelId}-`;
  if (!clientMsgId.startsWith(prefix)) return null;
  const rest = clientMsgId.slice(prefix.length);
  if (!/^\d+$/.test(rest)) return null;
  const seq = Number(rest);
  if (seq < 1 || !Number.isSafeInteger(seq)) return null;
  return seq;
}

/**
 * The participant identities a handshake create should seed, or `[]`.
 *
 * `[]` is the answer for every non-handshake create, and it is the answer the
 * NON-handshake path depends on: an empty list means `createTask` seeds nothing
 * and writes no participant rows, which leaves the thread on the creator/target
 * pair gate exactly as before.
 *
 * Each identity is validated HERE — the agent must still be an agent of this
 * channel, and every user must still be a member — so a stale `to_agent_ids`
 * entry drops out silently instead of throwing out of the seed and failing a
 * create. (`seedThreadParticipants` validates again, on purpose: it is the one
 * gate for every extra, caller-supplied or derived. The duplicate reads are a
 * handful on a create, and one validation contract is worth more than they
 * cost.)
 *
 * An addressed agent brings its OWNER in as a user participant too. That is not
 * a widening: the agent runs ON the owner's machine and every message it posts
 * carries the owner as `author_user_id`, so the owner is the identity the write
 * gate actually sees. Seeding only the agent row would admit the agent in name
 * and refuse it in practice on any post that did not also claim
 * `authorAgentId` — a distinction the addressing never made.
 *
 * Nothing is derived unless at least one addressed agent resolved: with no
 * agents there is no second writer to admit, and turning the thread into a
 * breakout room would change its gate for no one's benefit.
 */
export async function deriveHandshakeParticipants(
  channelId: string,
  clientMsgId: string | null | undefined
): Promise<ThreadParticipantRef[]> {
  const seq = parseHandshakeSeq(clientMsgId, channelId);
  if (seq === null) return [];

  const opener = await repoMessages.findMessageBySeq(channelId, seq);
  if (!opener) return [];

  const agentIds = readAddressedAgentIds(opener.metadata);
  if (agentIds.length === 0) return [];

  const refs: ThreadParticipantRef[] = [];
  const seen = new Set<string>();
  const add = (ref: ThreadParticipantRef) => {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const agentId of agentIds) {
    const agent = await repoAgents.findAgentById(agentId);
    if (!agent || agent.channel_id !== channelId) continue;
    const owner: ThreadParticipantRef = { kind: "user", id: agent.owner_user_id };
    // An agent outlives its owner's membership (`channel_agents` has no FK to
    // `channel_members`), so an owner who has left the room is skipped WITH the
    // agent — admitting a writer who can no longer read the channel is the one
    // thing a participant set must never do.
    if (!(await identityBelongs(channelId, owner))) continue;
    add({ kind: "agent", id: agent.id });
    add(owner);
  }
  if (refs.length === 0) return [];

  // The human who gave the instruction. Usually the thread's target as well (so
  // `seedThreadParticipants` would add them anyway), but not always — an agent
  // may open the thread addressed to the OTHER agent's owner, and the person who
  // asked for the work must not then be a stranger to the room it happens in.
  const author = opener.author_user_id;
  if (author) {
    const human: ThreadParticipantRef = { kind: "user", id: author };
    if (await identityBelongs(channelId, human)) add(human);
  }

  return refs;
}

/**
 * The agent ids a message ADDRESSED, read defensively off stored jsonb.
 *
 * `metadata.to_agent_ids` is server-stamped (reserved key, re-written only from
 * validated top-level fields), so this is reading the server's own record — but
 * it is still a jsonb column with no shape guarantee at the type level, and rows
 * predate the key entirely. Anything that is not a UUID string is skipped rather
 * than trusted, repeats collapse, and the list is capped.
 */
function readAddressedAgentIds(metadata: unknown): string[] {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const ids = meta.to_agent_ids;
  if (!Array.isArray(ids)) return [];
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !isUuid(id)) continue;
    if (out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_DERIVED_AGENTS) break;
  }
  return out;
}
