import "server-only";
import { agentIdHandle, buildAgentMentionIndex } from "../lib/agent-mentions";
import { agentIdOfSessionKey } from "../lib/agent-post-stamp";
import { mentionHandleOf, mentionTokensOf } from "../lib/mentions";
import type { SessionStateRow } from "./collab-dto";
// ⚠ `ChannelAgentHandleAmbiguousError` NO LONGER IMPORTED (2026-09-07): its one throw site here
// is deleted with the ambiguity it refused — suffix minting means no handle names two agents.
// The CLASS is left standing in `errors-recipient.ts` on purpose; it is a public error shape
// that older clients and the error-mapping table may still name, and retiring a wire-visible
// code is a separate decision from removing the branch that raised it.
import * as repoSessions from "./repository-sessions";
import { isFresh } from "./service-wake-freshness";
import { liveChannelSessions } from "./service-wake-verdict-resilience";
import type { ChannelContext } from "./service-shared";

/**
 * **WHICH AGENT A HANDLE NAMES — THE ONE DOOR, AND WHOSE SESSIONS IT LOOKS
 * THROUGH** (§1 split, 2026-09-04).
 *
 * ⚠ **ITS OWN FILE BECAUSE `service-wake-verdict.ts` REACHED THE 500-LINE CAP**,
 * and the seam is real rather than arithmetic: everything here changes when the
 * HANDLE GRAMMAR or the SCOPE an author may resolve against changes, and that
 * file changes when the PRECEDENCE between explicit addressing and repair does.
 * Same arrangement `service-wake-verdict-resilience.ts` already has, and the
 * import direction is the same: this is a leaf that file consumes.
 *
 * ⚠ **THE SCOPE RULE IS THE WHOLE SUBJECT, so it is stated once, here.** An
 * AGENT author resolves against its OWN operator's fresh sessions — Samuel's
 * 2026-08-31 same-account carve, enforced by which read is issued rather than by
 * a guard somebody can forget. A PERSON resolves against the ROOM's, because a
 * peer's agent is a real addressee a member can see and name, and because RR3
 * already routes an UNADDRESSED human post channel-wide: a typed handle asks for
 * strictly less reach than typing nothing.
 *
 * ⚠ **THE PARSER IS `lib/mentions.ts` + `lib/agent-mentions.ts`, IMPORTED, NEVER
 * RESTATED** — a third spelling of "what counts as an @-tag" is F-266, already
 * paid for once.
 */

/**
 * THE AUTHOR'S OWN SESSIONS IN THIS CHANNEL — **PRESENT ONLY, which is every
 * one of them**.
 *
 * ⚠ **OWN-SCOPED, AND THAT IS THE SAME-ACCOUNT CARVE GETTING ENFORCED FOR
 * FREE.** Every agent posts under its OPERATOR'S account (INVARIANTS §11), so
 * "sessions belonging to the author" is exactly the set Samuel's 2026-08-31 carve
 * permits an agent-authored message to wake. A peer's agent is not in it, cannot
 * be resolved here, and is therefore left to the machine that owns it —
 * `recipientAgentIds: null`, and the desktop's own parse decides. That is a
 * strictly weaker server answer, never a wrong one.
 * ⚠ **SCOPE IS NOW THE ONLY THING THIS FENCE ENFORCES**, and that is the point:
 * the carve is about WHOSE machine may be woken, never about how recently it
 * spoke.
 *
 * ⚠ **THE FRESHNESS FILTER LEFT ON 2026-09-05 AND THE DOCTRINE IT LEFT UNDER IS
 * ONE LINE: PRESENCE LICENSES RESOLUTION, FRESHNESS LICENSES ONLY REFUSAL.** It
 * read `updated_at` as a heartbeat. `channel_sessions` is a PROJECTION pushed on
 * state CHANGE — *"an agent thinking for four minutes writes nothing at all"* —
 * so a quiet row means nobody said anything, and filtering on it made a live
 * agent that had been idle five minutes unaddressable BY ITS OWN OPERATOR'S
 * AGENTS. Absence is carried by the push being a FULL-SET REPLACE, not by age.
 * Same ruling, same day, same reason as
 * `service-wake-verdict-resilience.ts › liveChannelSessions`; see that grave
 * block and Samuel's 2026-08-22 original (`agents-model.ts › peerCardsFor`).
 * ⚠ **WHERE `isFresh` STILL LIVES IS {@link ownLiveAgentIds}'s `projectionFresh`**
 * — the half that licenses a REFUSAL, which may only ever stand on positive
 * evidence. The two answers now come off the same rows and say different things,
 * which is exactly what F-418's asymmetry always claimed and what a single
 * filter could not express.
 */
async function ownSessions(
  ctx: ChannelContext,
  channelId: string
): Promise<SessionStateRow[]> {
  return repoSessions.listSessionStates(ctx.userId, ctx.workspaceId, channelId);
}

/**
 * **EVERY AGENT ID THE CALLER'S OWN LIVE SESSIONS ANSWER TO, IN THIS CHANNEL**
 * — the id door (`@agent-<id>` / `@<id>`) and the name door (`@<slug>`), through
 * the one index builder both web surfaces already use.
 *
 * ⚠ EXPORTED FOR `service-directions.ts`, WHICH ASKS THE SAME QUESTION ABOUT A
 * BARE ID RATHER THAN A BODY (G3 / F-418). One projection read, one freshness
 * rule, one place that decides what "a live agent of mine" means.
 *
 * ⚠ **TWO ANSWERS OFF ONE READ, AND THEY ARE DIFFERENT CLAIMS (2026-09-05).**
 * `ids` is PRESENCE — who is running — and licenses RESOLUTION.
 * `projectionFresh` is FRESHNESS — whether the projection has said anything
 * lately — and is the ONLY half a caller may REFUSE on. They used to be one
 * filtered list, which forced the weaker claim onto the stronger one: an
 * operator's own agent went unaddressable after five quiet minutes because the
 * set that answers "who is here" was being computed by the rule that answers "is
 * this evidence recent enough to turn somebody away".
 * ⚠ **F-589 IS UNTOUCHED.** The stamp check is `ids.includes(claim)` and `ids`
 * is still OWN-SCOPED by the read's fence; nothing cross-operator widens. What
 * changes is only that a quiet agent of MINE still counts as mine.
 */
export async function ownLiveAgentIds(
  ctx: ChannelContext,
  channelId: string,
  now = Date.now()
): Promise<{ ids: string[]; projectionFresh: boolean }> {
  const rows = await ownSessions(ctx, channelId);
  return {
    ids: rows.map((row) => row.name).filter((name) => name.length > 0),
    // ⚠ "THE PROJECTION HAS SOMETHING RECENT TO SAY", not "the agent is there".
    // A caller may only refuse on the strength of this being TRUE.
    // ⚠ `some(isFresh)` RATHER THAN `rows.length > 0` SINCE 2026-09-05 — the
    // rows are no longer pre-filtered, so the freshness test that used to happen
    // upstream happens here, on the one answer that still needs it. The claim it
    // makes is byte-for-byte the old one.
    projectionFresh: rows.some((row) => isFresh(row.updated_at, now)),
  };
}

/**
 * The agent ids a body names, or `null` when the server cannot answer.
 *
 * THREE OUTCOMES, AND THE THIRD IS THE ONE THAT MATTERS:
 *   - no handles at all      → `[]`. A complete answer: this body names no agent.
 *   - handles that resolve   → the ids. Authoritative; the desktop executes it.
 *   - handles that DO NOT    → `null`. The token may name an agent whose row has
 *     not been pushed yet, or a stale one. Answering `[]` here would tell the
 *     desktop "nobody", and it would stop feeding an agent it can see. `null`
 *     means "you decide", which is today's behaviour exactly.
 *
 * ⚠ **THE CANDIDATE SET IS THE AUTHOR'S KIND, AND THAT IS THE WHOLE OF THE
 * 2026-09-04 PEER-TAG FIX.** It read the AUTHOR'S OWN fresh sessions for both
 * kinds of author, so a HUMAN's `@agent-<id>` for a PEER's agent resolved to
 * nothing: #964, #967 and #970 of the Mobile Command Center incident carried the
 * tag and stored `wake_verdict=none`, `recipient_agent_ids=NULL`, and reached
 * the agent only because the desktop's own body parse repaired them one layer
 * down. A second live agent in the room, or a peer whose machine is not the one
 * that wrote the row, and the tag routed to nobody at all.
 *
 * ⚠ **THE AGENT-AUTHOR DOOR STAYS OWN-SCOPED — that is the same-account carve
 * (F-589, Samuel 2026-08-31) and it is not being widened.** An agent-authored
 * message may still only reach its own operator's agents. What changes is
 * strictly the HUMAN arm, and it is strictly narrower than RR3, which already
 * routes an UNADDRESSED human post channel-wide: a person who typed a handle is
 * asking for less reach than a person who typed nothing.
 *
 * ⚠ **AN AMBIGUOUS DISPLAY-NAME HANDLE IS NO LONGER A REFUSAL — IT IS A MINTED
 * SUFFIX** (2026-09-07, Samuel: *"if coder exists, then other slugs will be
 * coder-1, coder-2, coder-3"*). Channel-wide resolution is what makes the
 * collision ordinary rather than exotic — two operators, two agents both renamed
 * "Main" — and the old answer refused the WHOLE POST over it, listing claimants
 * as the id forms it had just refused. `buildAgentMentionIndex` gives the first
 * claimant `main` and the second `main-1`, so each handle names exactly one
 * agent and no pick is being made on the author's behalf.
 */
export async function resolveAgentRecipients(
  ctx: ChannelContext,
  channelId: string,
  body: string,
  /** The session that WROTE this body, from {@link selfAgentIdOf}. Dropped from
   *  the answer — see the docblock's self-address rule. */
  selfAgentId: string | null,
  /** `agent` keeps the own-scoped door; anything else resolves channel-wide. */
  authorKind: string,
  /**
   * **THE MEMBER HANDLES THIS ROOM'S ROSTER OCCUPIES — the reserved set that makes MEMBERS
   * OUTRANK AGENTS on the SERVER too** (2026-09-07, closing the parity gap me53qc4y named).
   *
   * ⚠ **THE CLIENT HAS RESERVED SINCE THE SUFFIX RULING AND THIS DOOR DID NOT**, which left one
   * body answered two ways: `lib/draft-recipients.ts › draftReach` builds its index with
   * `memberHandlesOf(members)`, so an agent an operator named "Diana" is `@diana-1` in the
   * composer's line while this index handed it the bare `@diana` and woke it. The composer
   * UNDERSTATED the reach — its stated safe direction — but the room still had two answers to
   * one token.
   *
   * ⚠ **IT COSTS NO READ, AND THAT IS THE ONLY REASON IT IS TAKEN HERE.** The handles are the
   * ones `service-writes-metadata-mentions.ts › resolveBodyMentions` already derived from the
   * roster and profiles it read one fold earlier on this same request, threaded down through
   * `PostMetadataResult`. This function issues no roster read of its own and must not grow one:
   * the member namespace is worth reserving, not worth two round trips on the hot write path
   * (INVARIANTS §12).
   *
   * ⚠ **EMPTY MEANS "NO MEMBER NAMESPACE TO RESPECT", NOT "NO MEMBERS"** — the same reading
   * `buildAgentMentionIndex` documents for the parameter. Every caller that has no roster in
   * hand (the harness, `service-directions.ts`) is unchanged, and the fail-safe direction is
   * today's behaviour rather than a new hazard.
   */
  reservedHandles: readonly string[] = []
): Promise<string[] | null> {
  const handles = mentionTokensOf(body)
    .map(mentionHandleOf)
    .filter((handle): handle is string => handle !== null);
  if (handles.length === 0) return [];

  // ⚠ **BOTH DOORS ARE PRESENCE-KEYED SINCE 2026-09-05, AND THE ONLY DIFFERENCE
  // LEFT BETWEEN THEM IS SCOPE — which is the only difference there was ever
  // supposed to be.** Freshness used to sit on both and it was answering a
  // question neither asked: this function RESOLVES, and an agent idle for five
  // minutes is not an agent that has gone away. See `ownSessions` and
  // `liveChannelSessions` for the ruling; `now` survives on this signature for
  // nothing else and is therefore gone.
  const rows =
    authorKind === "agent"
      ? await ownSessions(ctx, channelId)
      : await liveChannelSessions(ctx, channelId);
  const index = buildAgentMentionIndex(
    rows.map((row) => ({ agentId: row.name, displayName: row.display_name })),
    reservedHandles
  );
  const out: string[] = [];
  // ⚠ **"SOMETHING RESOLVED" IS TRACKED SEPARATELY FROM "SOMETHING IS LEFT".**
  // A body whose only handle named the AUTHOR resolved perfectly well; what it
  // named is not an addressee. Answering `null` there would send the desktop to
  // its own body parse, which would resolve the very same self-tag against its
  // live ids and feed the session its own post — the defect this drop exists to
  // close, re-introduced one layer down.
  let resolvedAny = false;
  for (const written of handles) {
    // ⚠ ONE NORMALISATION, THEN ONE LOOKUP. The bare `@<id>` form (F-448) is
    // tried only when the token AS WRITTEN claims nothing, so a display name
    // that happens to slug to eight id-shaped characters still wins its own
    // handle.
    const handle = index.has(written) ? written : (bareId(written) ?? written);
    if (!index.has(handle)) continue;
    // 🔒 **THE AMBIGUITY REFUSAL IS DELETED, AND THE TYPE IS THE PROOF** (2026-09-07, Samuel's
    // suffix ruling). `AgentMentionIndex` is `ReadonlyMap<string, string>` now: a contested
    // handle is MINTED (`coder`, `coder-1`, `coder-2`) rather than mapped to `null`, so there
    // is no value here that could mean "two agents claim this" and no branch left to take.
    //
    // ⚠ **IT WAS UNREACHABLE-BY-CONSTRUCTION, NOT MERELY UNOBSERVED, WHICH IS WHY IT GOES
    // RATHER THAN STAYING AS A GUARD.** `buildAgentMentionIndex` never writes a handle twice —
    // `claim` refuses an occupied key instead of overwriting it — so `index.get` on a key
    // `index.has` just confirmed returns a string. A defensive `if (id === null) throw` kept
    // here would be a refusal no input can produce, and this file already carries the lesson
    // that a refusal nobody can trigger is indistinguishable from one nobody has tested.
    //
    // ⚠ **AND THE REFUSAL IT REPLACED WAS ITSELF A LOOP** — the error listed its claimants AS
    // THEIR ID FORMS, so it told the writer to retry with the exact handle it had just refused.
    const id = index.get(handle) as string;
    resolvedAny = true;
    if (id === selfAgentId) continue;
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > 0) return out;
  return resolvedAny ? [] : null;
}

// ⚠ **`claimants` IS DELETED (2026-09-07), NOT LEFT FOR A FUTURE CALLER.** It listed every live
// agent contesting one handle, as the id forms that still reached each — the list
// `ChannelAgentHandleAmbiguousError` carried to be actionable. Suffix minting removed the
// refusal, which was its only caller: a handle now names exactly one agent, so there is no
// contested set left to enumerate. Keeping it would have been a helper whose whole subject no
// longer exists, and the next reader would have had to reconstruct the deleted branch to find
// out why nothing called it.

/**
 * **THE SESSION THAT WROTE THIS POST** — `metadata.session_id`'s agent segment,
 * or `null` when a person wrote it (2026-09-04).
 *
 * ⚠ **IT IS READ OFF THE SERVER'S OWN STAMP AND NOT OFF `client_msg_id`.** The
 * stamp door (`lib/agent-post-stamp.ts › parseAgentPostStamp`) is blank for every
 * post that carried its own idempotency key, which is exactly the class of post
 * that self-woke in the Mobile Command Center incident: `metadata.session_id` is
 * stripped from caller input and re-stamped from the session header
 * (`service-writes-metadata.ts` fold 6b), so it is both unforgeable and always
 * present on a desktop-session post.
 *
 * ⚠ **GATED ON `authorKind`.** A member's cookie session also carries a
 * `session_id`, and a person is not an agent — reading it unconditionally would
 * invent an author agent for a human post and quietly withdraw that agent from
 * its own room's addressing.
 */
export function selfAgentIdOf(
  metadata: Record<string, unknown>,
  authorKind: string
): string | null {
  if (authorKind !== "agent") return null;
  const sessionId = metadata.session_id;
  return agentIdOfSessionKey(typeof sessionId === "string" ? sessionId : null);
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
