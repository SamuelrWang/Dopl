import "server-only";
import { agentIdHandle, buildAgentMentionIndex } from "../lib/agent-mentions";
import { agentIdOfSessionKey } from "../lib/agent-post-stamp";
import { mentionHandleOf, mentionTokensOf } from "../lib/mentions";
import type { SessionStateRow } from "./collab-dto";
// ⚠ `ChannelAgentHandleAmbiguousError` IS DELIBERATELY NOT IMPORTED (2026-09-15). Samuel's
// commit-time rule means no two ADDRESSABLE agents in a channel share a name — the second is
// stored as `Coder-1` (`main/agent-name-unique.js`) — so there is no ambiguity left for an error
// to describe. The CLASS stays in `errors-recipient.ts`: it is a wire-visible code older clients
// may still name, and retiring one is a separate decision.
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
 * THE AUTHOR'S OWN SESSIONS IN THIS CHANNEL — **PRESENT ONLY, which is every one of them**.
 *
 * ⚠ **OWN-SCOPED, AND THAT IS THE SAME-ACCOUNT CARVE ENFORCED BY WHICH READ IS ISSUED.** Every
 * agent posts under its OPERATOR'S account (INVARIANTS §11), so this is exactly the set Samuel's
 * 2026-08-31 carve permits an agent-authored message to wake. A peer's agent is left to the
 * machine that owns it — `recipientAgentIds: null` — a strictly weaker answer, never a wrong one.
 *
 * 🔒 **PRESENCE LICENSES RESOLUTION; FRESHNESS LICENSES ONLY REFUSAL** (2026-09-05).
 * `channel_sessions` is a PROJECTION pushed on state CHANGE — *"an agent thinking for four
 * minutes writes nothing at all"* — so a quiet row means nobody said anything, and filtering on
 * `updated_at` made an operator's own idle agent unaddressable. Absence is carried by the push
 * being a FULL-SET REPLACE, not by age. `isFresh` survives only in {@link ownLiveAgentIds}'s
 * `projectionFresh`, the half that licenses a REFUSAL (F-418's asymmetry).
 */
async function ownSessions(
  ctx: ChannelContext,
  channelId: string
): Promise<SessionStateRow[]> {
  return repoSessions.listSessionStates(ctx.userId, ctx.workspaceId, channelId);
}

/**
 * **EVERY AGENT ID THE CALLER'S OWN LIVE SESSIONS ANSWER TO, IN THIS CHANNEL** — the id door
 * (`@agent-<id>` / `@<id>`) and the name door (`@<slug>`), through the one index builder both
 * web surfaces already use.
 *
 * ⚠ EXPORTED FOR `service-directions.ts`, which asks the same question about a BARE ID rather
 * than a body (G3 / F-418) — one read, one place that decides what "a live agent of mine" means.
 *
 * ⚠ **TWO ANSWERS OFF ONE READ, AND THEY ARE DIFFERENT CLAIMS** (2026-09-05). `ids` is PRESENCE
 * and licenses RESOLUTION; `projectionFresh` is FRESHNESS and is the ONLY half a caller may
 * REFUSE on. ⚠ **F-589 IS UNTOUCHED** — the stamp check is `ids.includes(claim)` over a set the
 * read's own fence keeps own-scoped.
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
 *   - handles the MEMBER namespace holds → `[]` too. `@samuel` names a member, so this body
 *     names no AGENT; see the drop inside the loop for why the distinction is load-bearing.
 *   - handles that DO NOT    → `null`. The token may name an agent whose row has
 *     not been pushed yet, or a stale one. Answering `[]` here would tell the
 *     desktop "nobody", and it would stop feeding an agent it can see. `null`
 *     means "you decide", which is today's behaviour exactly.
 *
 * 🔒 **THE CANDIDATE SET IS THE AUTHOR'S KIND** (2026-09-04, the peer-tag fix). An AGENT author
 * reads its OWN sessions — the same-account carve (F-589, Samuel 2026-08-31), not being widened —
 * and a PERSON reads the ROOM's, which is strictly narrower than RR3 already routing an
 * UNADDRESSED human post channel-wide. Reading own-scoped rows for BOTH kinds is what made a
 * human's `@agent-<id>` for a PEER's agent resolve to nothing.
 *
 * ⚠ **THERE IS NO AMBIGUOUS DISPLAY-NAME HANDLE ANY MORE** (Samuel, 2026-09-15: *"no two agents
 * that are addressable can have the same name"*). The rule lives where the name is COMMITTED
 * (`main/agent-name-unique.js`), so the second "Main" is STORED as `Main-1` and this lane has one
 * agent per handle by construction. ⚠ **THE ONE CASE IT CANNOT COVER IS CROSS-MACHINE** — names
 * are minted on the machine that owns the id, so two MEMBERS can still each run a "Main";
 * `buildAgentMentionIndex` names the first claimant, which never re-points or withdraws one.
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
   * OUTRANK AGENTS on the SERVER too** (2026-09-07, closing a client/server parity gap:
   * `lib/draft-recipients.ts › draftReach` had reserved them and this door had not, so one token
   * had two answers).
   *
   * ⚠ **IT COSTS NO READ, AND THAT IS THE ONLY REASON IT IS TAKEN HERE** — the handles are the
   * ones `service-writes-metadata-mentions.ts › resolveBodyMentions` already derived one fold
   * earlier on this same request. This function issues no roster read and must not grow one
   * (INVARIANTS §12).
   *
   * ⚠ **EMPTY MEANS "NO MEMBER NAMESPACE TO RESPECT", NOT "NO MEMBERS"** — every caller without
   * a roster in hand (the harness, `service-directions.ts`) is unchanged.
   */
  reservedHandles: readonly string[] = []
): Promise<string[] | null> {
  const handles = mentionTokensOf(body)
    .map(mentionHandleOf)
    .filter((handle): handle is string => handle !== null);
  if (handles.length === 0) return [];
  const reserved = new Set(
    Array.from(reservedHandles, (handle) => handle.trim().toLowerCase()).filter(
      (handle) => handle.length > 0
    )
  );

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
    if (!index.has(handle)) {
      // ⚠ **A MEMBER'S HANDLE IS A RESOLVED ADDRESS, NOT AN UNRESOLVED AGENT ONE** (2026-09-15).
      // The member namespace outranks the agent one, so `@samuel` is deliberately absent from
      // this index — but answering `null` for it tells `service-wake-verdict.ts` the author typed
      // a handle this server cannot place, which turns off RR3 and stamps the post `unreachable`.
      // `resolveBodyMentions` already resolved this token one fold earlier, on the same request.
      if (reserved.has(handle)) resolvedAny = true;
      continue;
    }
    // 🔒 **A HANDLE NAMES EXACTLY ONE AGENT, AND THE TYPE IS THE PROOF** (Samuel, 2026-09-15).
    // `AgentMentionIndex` is `ReadonlyMap<string, string>`: there is no value here that could
    // mean "two agents claim this" and no branch left to take, because the COLLISION is prevented
    // where the name is committed — a second "Coder" is stored as `Coder-1`
    // (`main/agent-name-unique.js`). ⚠ `buildAgentMentionIndex` never writes a handle twice, so
    // `index.get` on a key `index.has` just confirmed returns a string.
    const id = index.get(handle) as string;
    resolvedAny = true;
    if (id === selfAgentId) continue;
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > 0) return out;
  return resolvedAny ? [] : null;
}

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
 * ⚠ **THE PREFIX IS OPTIONAL ON THE MACHINE AND MANDATORY IN THE WEB INDEX — F-448.**
 * `main/session-dispatch.js › mentionedAgentIds` matches `@(?:agent-)?([a-z][a-z0-9]{7})`, while
 * `buildAgentMentionIndex` claims only `agent-<id>` and the slug; resolving only the index's
 * forms would answer `unreachable` for a bare id the desktop routes happily.
 *
 * ⚠ **IT IS A NORMALISATION, NOT A SECOND PARSER** — the token still comes from
 * `mentionTokensOf`/`mentionHandleOf` and the lookup is still the one index. The proper fix
 * belongs in the index (so the transcript TINTS the form it routes on) and is filed as F-448,
 * because that is a rendering change.
 */
const BARE_AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;
function bareId(handle: string): string | null {
  return BARE_AGENT_ID_RE.test(handle) ? agentIdHandle(handle) : null;
}
