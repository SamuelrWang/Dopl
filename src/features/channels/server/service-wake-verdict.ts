import "server-only";
import { SESSION_PROJECTION_FRESH_MS } from "../constants";
import type { ChannelDelivery, ChannelWakeVerdict } from "../types";
import type { ChannelMessageCreateInput } from "../schema";
import {
  agentIdHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "../lib/agent-mentions";
import { mentionHandleOf, mentionTokensOf } from "../lib/mentions";
import type { SessionStateRow } from "./collab-dto";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * **WHO A MESSAGE IS FOR, AND WHETHER IT WOKE ANYBODY — DECIDED ON THE SERVER,
 * ONCE, AT WRITE TIME** (2026-09-02, A9; guardrails G11, G12, G15).
 *
 * ⚠ **THIS FILE EXISTS BECAUSE THE RULE USED TO LIVE ON EVERY DESKTOP AND
 * NOWHERE ELSE.** `main/session-dispatch.js › mentionedAgentIds` parsed the
 * BODY, `main/session-wake-tiers.js` decided the wake and `main/targeting.js`
 * classified in parallel — three modules, each stating that it must not read the
 * others — while the server stored the row with no delivery semantics at all.
 * The consequences were not stylistic: the addressing doctrine had to be written
 * against the WEAKEST build in the field (`packages/mcp-server/src/tools/
 * channel-addressing.ts` says so in as many words), and "a message @-mentioning
 * another agent is not addressed to you" was a request, because every live
 * session on the thread was handed the same `addressing` array.
 *
 * ⚠ **IT DECIDES; IT DOES NOT DELIVER.** No server can reach a desktop's session
 * registry. What this produces is a STORED ANSWER the machine executes, and the
 * machine's own report comes back on the ack lane
 * (`service-writes-delivery.ts`). The two are different columns because they are
 * different claims — a prediction and a receipt.
 *
 * ⚠ **AND IT DOES NOT NARROW THE FAN-OUT.** Whether a thread message still feeds
 * every live agent on it is Samuel's ruling 4 of 2026-08-21, and reversing it is
 * spec ruling B1 — his call, not this slice's. Everything here is additive: the
 * desktop gains an answer it did not have and loses no reach.
 */

/**
 * ⚠ **THE PARSER IS `lib/mentions.ts` + `lib/agent-mentions.ts`, IMPORTED, NEVER
 * RESTATED.** Those two already own the handle grammar for the web transcript's
 * tint, and `service-writes-metadata-mentions.ts` already resolves the MEMBER
 * namespace through them on this exact write path. A third spelling of "what
 * counts as an @-tag" is how the tint, the stamp and the wake come to disagree —
 * which is F-266, already paid for once.
 *
 * ⚠ The two namespaces stay separate: `lib/mentions.ts` answers *which MEMBER*,
 * this answers *which AGENT*, and an agent is not a member.
 */
export interface WakeVerdictResult {
  verdict: ChannelWakeVerdict;
  /** ⚠ `null` = NOT RESOLVED HERE, and the desktop then falls back to its own
   *  body parse. `[]` = resolved to nobody. Never collapse the two. */
  recipientUserIds: string[] | null;
  recipientAgentIds: string[] | null;
  /** The server's write-time answer to "what happened". A prediction until the
   *  machine acks. */
  delivery: ChannelDelivery;
}

/** The stored `delivery` a verdict predicts, before any machine has spoken. */
const DELIVERY_FOR: Record<ChannelWakeVerdict, ChannelDelivery> = {
  none: "none",
  member: "delivered",
  agent: "woken",
  thread: "idle",
};

/**
 * THE AUTHOR'S OWN LIVE SESSIONS IN THIS CHANNEL, **FRESH ONLY**.
 *
 * ⚠ **OWN-SCOPED, AND THAT IS THE SAME-ACCOUNT CARVE GETTING ENFORCED FOR
 * FREE.** Every agent posts under its OPERATOR'S account (INVARIANTS §11), so
 * "sessions belonging to the author" is exactly the set Samuel's 2026-08-31 carve
 * permits an agent-authored message to wake. A peer's agent is not in it, cannot
 * be resolved here, and is therefore left to the machine that owns it —
 * `recipientAgentIds: null`, and the desktop's own parse decides. That is a
 * strictly weaker server answer, never a wrong one.
 *
 * ⚠ **FRESHNESS IS THE F-418 RULE AND IT IS ASYMMETRIC.** `channel_sessions` is
 * a PROJECTION the desktop pushes on state change; a quiet row means nobody said
 * anything, not that nothing is running. So a fresh row is evidence enough to
 * RESOLVE, and a stale one is not evidence of ABSENCE — which is why a body with
 * unresolvable handles answers `null` (defer to the machine) rather than `[]`
 * (nobody). {@link SESSION_PROJECTION_FRESH_MS} carries the window.
 */
async function freshOwnSessions(
  ctx: ChannelContext,
  channelId: string,
  now: number
): Promise<SessionStateRow[]> {
  const rows = await repoSessions.listSessionStates(
    ctx.userId,
    ctx.workspaceId,
    channelId
  );
  return rows.filter((row) => isFresh(row.updated_at, now));
}

/** ⚠ AN UNPARSEABLE STAMP IS STALE, not fresh — the fail-safe direction for a
 *  window that licenses a refusal elsewhere (`service-directions.ts`). */
function isFresh(updatedAt: string | null, now: number): boolean {
  const at = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(at)) return false;
  return now - at < SESSION_PROJECTION_FRESH_MS;
}

/**
 * **EVERY AGENT ID THE CALLER'S OWN FRESH SESSIONS ANSWER TO, IN THIS CHANNEL**
 * — the id door (`@agent-<id>` / `@<id>`) and the name door (`@<slug>`), through
 * the one index builder both web surfaces already use.
 *
 * ⚠ EXPORTED FOR `service-directions.ts`, WHICH ASKS THE SAME QUESTION ABOUT A
 * BARE ID RATHER THAN A BODY (G3 / F-418). One projection read, one freshness
 * rule, one place that decides what "a live agent of mine" means.
 */
export async function ownLiveAgentIds(
  ctx: ChannelContext,
  channelId: string,
  now = Date.now()
): Promise<{ ids: string[]; projectionFresh: boolean }> {
  const rows = await freshOwnSessions(ctx, channelId, now);
  return {
    ids: rows.map((row) => row.name).filter((name) => name.length > 0),
    // ⚠ "THE PROJECTION HAS SOMETHING RECENT TO SAY", not "the agent is there".
    // A caller may only refuse on the strength of this being TRUE.
    projectionFresh: rows.length > 0,
  };
}

/**
 * The agent ids a body names, or `null` when the server cannot answer.
 *
 * THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MATTERS:
 *   - no handles at all      → `[]`. A complete answer: this body names no agent.
 *   - handles that resolve   → the ids. Authoritative; the desktop executes it.
 *   - handles that DO NOT    → `null`. The token may name a PEER's agent (whose
 *     id is minted on their machine and known to no server) or one whose row has
 *     not been pushed yet. Answering `[]` here would tell the desktop "nobody",
 *     and it would stop feeding an agent it can see. `null` means "you decide",
 *     which is today's behaviour exactly.
 */
async function resolveAgentRecipients(
  ctx: ChannelContext,
  channelId: string,
  body: string,
  now: number
): Promise<string[] | null> {
  const handles = mentionTokensOf(body)
    .map(mentionHandleOf)
    .filter((handle): handle is string => handle !== null);
  if (handles.length === 0) return [];

  const rows = await freshOwnSessions(ctx, channelId, now);
  const index = buildAgentMentionIndex(
    rows.map((row) => ({ agentId: row.name, displayName: row.display_name }))
  );
  const out: string[] = [];
  for (const handle of handles) {
    const id =
      resolveAgentHandle(handle, index) ?? resolveAgentHandle(bareId(handle), index);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : null;
}

/**
 * `@<id>` → the `agent-<id>` handle the index claims.
 *
 * ⚠ **THE PREFIX IS OPTIONAL ON THE MACHINE AND MANDATORY IN THE WEB INDEX, AND
 * THAT DISAGREEMENT IS REAL — see F-448.** `main/session-dispatch.js ›
 * mentionedAgentIds` matches `@(?:agent-)?([a-z][a-z0-9]{7})` because *"the bare
 * `@<id>` form is what every message written before [2026-08-27] carries"*, while
 * `lib/agent-mentions.ts › buildAgentMentionIndex` claims only `agent-<id>` and
 * the slug. A server that resolved only the index's forms would answer
 * `unreachable` for a bare id the desktop routes happily, which is a WORSE lie
 * than the one this slice exists to remove.
 *
 * ⚠ **IT IS A NORMALISATION, NOT A SECOND PARSER.** The token still comes from
 * `mentionTokensOf`/`mentionHandleOf` and the lookup is still the one index; all
 * this does is try the canonical spelling of a handle that is already a
 * well-formed agent id. The fix belongs in the index (so the transcript TINTS
 * the form it routes on) and is filed rather than taken, because that is a
 * rendering change and this slice is not a rendering slice.
 */
const BARE_AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;
function bareId(handle: string): string | null {
  return BARE_AGENT_ID_RE.test(handle) ? agentIdHandle(handle) : null;
}

/**
 * **THE VERDICT.** Runs on the write path, after `resolvePostMetadata` has
 * decided what `metadata` holds, so it reads the SERVER'S OWN stamps
 * (`to_user_id`, `taskId`) and never the caller's claim.
 *
 * PRECEDENCE — strongest reach first, because the verdict answers *what this
 * message DID*, and waking an agent is the loudest thing it can do:
 *   1. `agent`   the body named a live agent of the author's own.
 *   2. `member`  `to=` named a member; their side decides what runs.
 *   3. `thread`  no recipient, but a thread tag — it reaches sessions already
 *                working that thread and wakes nothing.
 *   4. `none`    nothing.
 *
 * ⚠ **ONLY `kind: 'message'` CAN REACH A SESSION** (`main/session-dispatch.js ›
 * feedLiveSession`, the kind filter it calls "the last word on this machine"), so
 * a lifecycle marker or a milestone resolves the MEMBER half and stops. Stating
 * it here rather than letting the agent half quietly resolve to nothing keeps the
 * two facts separable when the kind set moves — which `scripts/
 * check-message-kind-drift.ts` now guards.
 *
 * ⚠ **THE LOOP FENCE IS STRUCTURAL, NOT A BRANCH.** An agent-authored message
 * cannot reach an agent that is not its own operator's, because the resolution
 * is scoped to the author's own sessions. There is deliberately no
 * `authorKind === "agent"` test here: a second spelling of the loop fence is
 * exactly what the desktop's three-module version cost.
 *
 * ⚠ **THE ESCALATION-ANSWER DOOR IS NOT RESOLVED HERE, DELIBERATELY.**
 * `metadata.escalationAnswer.agentId` names the agent that ASKED, which belongs
 * to whoever posted the escalation — usually not the author. The machine unions
 * it in (`main/session-dispatch.js › escalationAnswerAgentIds`) against the ids
 * live on the thread, which is the only place that fact is knowable. Resolving it
 * here would mean answering `[]` for it, and `[]` is authoritative.
 */
export async function resolveWakeVerdict(
  ctx: ChannelContext,
  channelId: string,
  input: ChannelMessageCreateInput,
  metadata: Record<string, unknown>,
  now = Date.now()
): Promise<WakeVerdictResult> {
  const toUserId =
    typeof metadata.to_user_id === "string" ? metadata.to_user_id : null;
  const recipientUserIds = toUserId ? [toUserId] : [];
  const threaded = typeof metadata.taskId === "string";

  const recipientAgentIds =
    (input.kind ?? "message") === "message"
      ? await resolveAgentRecipients(ctx, channelId, input.body, now)
      : null;

  const verdict: ChannelWakeVerdict =
    recipientAgentIds !== null && recipientAgentIds.length > 0
      ? "agent"
      : toUserId
        ? "member"
        : threaded
          ? "thread"
          : "none";

  return {
    verdict,
    recipientUserIds,
    recipientAgentIds,
    // ⚠ **`unreachable` IS AN OUTCOME THE VERDICT ENUM CANNOT EXPRESS, WHICH IS
    // WHY THE TWO ARE SEPARATE FIELDS.** The body named an agent and nothing this
    // server can see answers to it. Reporting the verdict's own outcome instead
    // would say "you addressed nobody" (`none`) or "it went to the thread"
    // (`idle`) about a post whose whole point was a name — precisely the
    // silent-miss G15 describes.
    // ⚠ **A STRONGER REACH WINS.** An unresolvable handle beside a real `to=`,
    // or beside an agent that DID resolve, is not the story of that message: it
    // reached somebody, and the machine settles the rest.
    delivery:
      recipientAgentIds === null && verdict !== "agent" && verdict !== "member"
        ? "unreachable"
        : DELIVERY_FOR[verdict],
  };
}
