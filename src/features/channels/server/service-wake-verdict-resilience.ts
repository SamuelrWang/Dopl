import "server-only";
import { RESILIENCE_WINDOW_MS } from "@/shared/channels/caps";
import type { ChannelMessageCreateInput } from "../schema";
import {
  resolveDefaultResponder,
  type ResponderChoice,
} from "../lib/agent-mentions";
import { authorAgentIdOf, recentAgentsAddressedBy } from "../lib/agent-post-stamp";
import type { SessionStateRow } from "./collab-dto";
import type { ChannelRow } from "./dto";
import * as repoMessages from "./repository-messages";
import * as repoSessions from "./repository-sessions";
import type { ChannelContext } from "./service-shared";

/**
 * **THE THREE RESILIENCE RULES** (2026-09-02, v2 wave B slice B4 — Samuel's
 * ruling B1), one function each.
 *
 * ⚠ **ITS OWN FILE (§1) BECAUSE `service-wake-verdict.ts` REACHED THE 500-LINE
 * CAP**, and the seam is real rather than arithmetic: everything here changes
 * when a RESILIENCE rule changes, and that file when the PRECEDENCE between
 * explicit addressing and repair does. Same arrangement `service-writes.ts` /
 * `service-writes-direct.ts` and `types.ts` / `types-delivery.ts` already have —
 * `service-wake-verdict.ts` is the entry point and there is no second caller of
 * anything here.
 *
 * ⚠ **THEY EXIST BECAUSE THE FAN-OUT NARROWS** (`b-fanout-narrow`). Narrowing
 * delivery to the addressed recipient, on its own, means a message that named
 * nobody reaches nobody — and Samuel's ruling in the same breath is that a
 * forgotten `@` must never stall a conversation. The repair is the SERVER'S, so
 * every desktop gets it at once and the weakest build in the field does not set
 * the rule.
 *
 * ⚠ **THE ARMS ARE DISJOINT BY (in a thread?) × (author kind), SO EXACTLY ONE
 * FIRES**, and the caller applies them in that shape. None of them is a fallback
 * for another: RR1 answering nobody does not hand the message to RR3.
 */

/**
 * **EVERY AGENT LIVE IN THIS ROOM, WHOEVER RUNS IT** — RR3's candidate set, and
 * the LIST a `delivery=none` reports.
 *
 * ⚠ **CHANNEL-WIDE, AND THAT IS NOT THE CROSS-ACCOUNT WAKE THE CARVE FORBIDS.**
 * Both its callers are gated on a PERSON having written the message — RR3, and
 * (since 2026-09-04) `service-wake-verdict.ts › resolveAgentRecipients`'s human
 * arm. An unaddressed human post already reaches every machine's agents in the
 * room today, each machine feeding its own; a human post that TYPED a handle is
 * asking for strictly less than that. The carve is about what an AGENT-authored
 * message may start, and no path from an agent author reaches this function: the
 * two doors an agent author CAN take stay own-scoped by construction
 * (`resolveAgentRecipients`'s agent arm, and
 * `service-writes-metadata-recipient.ts › liveAgentHandles` for `to=`).
 * ⚠ There is deliberately no `authorKind` test INSIDE this function; a second
 * spelling of the fence is what the desktop's three-module version cost. The
 * gate lives at each call site, where the credential is already in hand.
 *
 * ⚠ **PRESENCE, NOT RECENCY — LIVENESS IS MEMBERSHIP (Samuel, 2026-08-22).** The
 * push is a FULL-SET REPLACE keyed on `(user, workspace)` and
 * `main/session-state-push.js › liveForWire` drops ended rows before they are
 * sent, so a session that has gone away is deleted BY OMISSION: a row in this
 * read is a session that has not gone away. That is the whole test.
 *
 * ⚠ **THE WALL-CLOCK FRESHNESS FILTER IS DELETED HERE, AND ITS GRAVE IS THIS
 * BLOCK.** It stood until 2026-09-05 and it read `updated_at` as a HEARTBEAT,
 * which that column has never been — the push fires on state CHANGE only, so
 * *"an agent thinking for four minutes writes nothing at all"* and one idle for
 * an hour writes nothing either. Filtering on it collapsed
 * `service-wake-freshness.ts › isFresh`'s own asymmetry at the exact point that
 * docblock forbids: a filtered-out row is indistinguishable from a row that is
 * not there, so STALE was read as ABSENT. Rows #1080, #1081 and #1092 of the
 * Mobile Command Center are the bill — three agents deliberately idle on a
 * verification hold, every row aged past the window, candidate list EMPTY, and
 * every untagged post by the operator stored `verdict=none` while three agents
 * sat listening in the room.
 * ⚠ **THIS IS SAMUEL'S 2026-08-22 AGENTS-TAB RULING, REACHING THE SURFACE THAT
 * NEVER TOOK IT** — *"the card STAYS until the session actually goes away"*. See
 * `components/channels-v2/agents-model.ts › peerCardsFor`, which deleted the
 * identical guard for the identical reason and states the argument in full. A
 * liveness rule built on a stamp that is not a heartbeat cannot be tuned; it has
 * to go.
 * ⚠ **`isFresh` SURVIVES ONLY WHERE IT LICENSES A REFUSAL** — `ownLiveAgentIds`'s
 * `projectionFresh`, which a caller may act on only when TRUE. Resolving is the
 * other direction and does not need it.
 *
 * ⚠ **A NAMELESS ROW IS STILL DROPPED, AND THAT IS NOT A FRESHNESS RULE.**
 * `name` IS the agent id every door addresses; a row that carries none names
 * nobody and could not be woken if it were picked.
 */
export async function liveChannelSessions(
  ctx: ChannelContext,
  channelId: string
): Promise<SessionStateRow[]> {
  const rows = await repoSessions.listChannelSessionStates(
    ctx.workspaceId,
    channelId
  );
  return rows.filter((row) => row.name.length > 0);
}

/**
 * **RR1 — A THREAD REPLY WITH NO `to` GOES TO THE THREAD'S OTHER PARTY.**
 *
 * ⚠ **"OTHER" IS TOTAL BECAUSE A THREAD HAS EXACTLY TWO PARTIES.**
 * `isThreadParticipant` 403s a third before this ever runs, so the author is one
 * of `{created_by, target_user_id}` and the answer is the one they are not.
 *
 * ⚠ **IT READS THE SERVER'S OWN STAMPS AND COSTS NO ROUND TRIP.**
 * `resolvePostMetadata` fold 3 has already re-stamped `taskCreatedBy` /
 * `taskTarget` from the resolved thread row, so the pair is here for free and is
 * the same pair the fence checked. Re-reading `channel_tasks` would be a second
 * read that can only agree.
 *
 * ⚠ **A LEGACY `task-<channelId>-<seq>` TAG RESOLVES TO NOBODY HERE, ON
 * PURPOSE.** Those ids match no row, so fold 3 stamps none of the four keys (the
 * titleless card is the tell) and this answers `null` — the send then keeps the
 * pre-existing `thread` verdict: it reaches sessions already working that thread
 * and wakes nothing. That is the behaviour those posts have today, and inventing
 * a party for them would mean a second read of the OPENER on every lifecycle
 * echo an installed desktop sends.
 *
 * ⚠ **AN UNADDRESSED THREAD (`taskTarget` absent) ALSO RESOLVES TO NOBODY** —
 * there is no other party to be the other of.
 */
export function threadOtherParty(
  ctx: ChannelContext,
  metadata: Record<string, unknown>
): string | null {
  const createdBy =
    typeof metadata.taskCreatedBy === "string" ? metadata.taskCreatedBy : null;
  const target =
    typeof metadata.taskTarget === "string" ? metadata.taskTarget : null;
  if (createdBy === null) return null;
  if (ctx.userId === createdBy) return target;
  if (ctx.userId === target) return createdBy;
  return null;
}

/**
 * **RR2 — AN UNADDRESSED AGENT POST IN THE MAIN ROOM GOES BACK TO WHOEVER LAST
 * ADDRESSED THAT AGENT THERE.**
 *
 * SELECTION, EXACTLY: the highest `seq` among rows in THIS channel with no
 * thread tag, created inside `RESILIENCE_WINDOW_MS`, whose STORED
 * `recipient_agent_ids` names this agent. **`seq` is unique per channel, so the
 * ordering is total and NO TIE IS REPRESENTABLE** — there is no tie-break to
 * specify and none to get wrong.
 *
 * ⚠ **IT RESOLVES TO A MEMBER, NEVER TO AN AGENT, AND THAT IS WHAT MAKES THE
 * SAME-ACCOUNT CARVE HOLD THROUGH THIS ARM.** "The party that addressed me" is
 * the `author_user_id` of that row — a person's account, whose own machine
 * decides what runs. An arm that resolved an AGENT id here could aim an
 * agent-authored wake at a peer's agent, which is precisely what Samuel's
 * 2026-08-31 carve forbids, and it would do it through a rule the author never
 * wrote.
 *
 * ⚠ **THE AUTHOR'S OWN AGENT ID COMES OFF `lib/agent-post-stamp.ts ›
 * authorAgentIdOf`, THE ONE PARSER** — the `client_msg_id` stamp, else the
 * server's own `metadata.session_id`. `null` there is "cannot say", never "some
 * other agent": an agent post that carries neither gets NO reciprocal arm and
 * answers `delivery=none`. Guessing which agent wrote it would aim somebody's
 * reply at the wrong conversation.
 *
 * ⚠ **IT KEYED ON THE STAMP ALONE UNTIL 2026-09-04, AND THAT STAMPED
 * `delivery=unreachable` OVER A FAILURE THAT NEVER HAPPENED.**
 * `main/session-outbound-tag.js › threadTagFor` deliberately never overwrites a
 * `client_msg_id` an agent supplied, so `parseAgentPostStamp` was `null` for
 * every such post — no arm fired, `resilience` stayed null, and the verdict's
 * `unreachable` term (the one an orchestrator ACTS on) fired instead: rows #963,
 * #965, #969 and #973 of the Mobile Command Center incident all reported a
 * delivery failure for messages that were delivered. `metadata.session_id` is
 * stripped from caller input and re-stamped from `X-Dopl-Session-Id`
 * (`service-writes-metadata.ts` fold 6b), so it is present on every
 * desktop-session post and cannot be posed — the STRONGER fact, not a fallback.
 * ⚠ The F-589 own-scope check below is unchanged and still applies to both
 * doors: the `client_msg_id` half remains caller-supplied.
 *
 * 🔒 ⚠ **AND `client_msg_id` IS CALLER-SUPPLIED, SO THE STAMP IS A CLAIM AND IS
 * CHECKED (2026-09-02, F-589).** It was not. Agent ids are not secret — the
 * desktop stamps `agent-<agentId>-<n>` and `agentId` is publicly readable off
 * `channel_sessions.name` — so any caller could post `client_msg_id:
 * "agent-<someone else's id>-1"` and have this arm answer with the member who
 * last addressed THAT agent. The message then lands in front of a person who was
 * mid-conversation with a different agent, attributed to the wrong exchange,
 * from a room they may not have been talking in at all. It is the same class of
 * defect the author-scoped idempotency probe closed in `service-writes.ts`, on
 * the same field, and one door along.
 *
 * ⚠ **THE CHECK IS `ownAgentIds`, PASSED IN RATHER THAN COMPUTED HERE.** "A live
 * agent of mine" has ONE definition (`service-wake-verdict.ts ›
 * ownLiveAgentIds`) and this module cannot import it — that file imports this
 * one. A second spelling of the own-scope rule is exactly what the desktop's
 * three-module version cost, so the caller resolves it and hands it over.
 * ⚠ A STALE PROJECTION THEREFORE ANSWERS `null`, not "trust the stamp": this arm
 * RESOLVES a recipient off a CALLER-SUPPLIED claim, and `service-wake-freshness.ts
 * › isFresh`'s asymmetry says a fresh row is evidence enough to resolve while a
 * stale one is not evidence of anything.
 * ⚠ **THAT IS A DIFFERENT QUESTION FROM {@link liveChannelSessions}'S, WHICH
 * DROPPED ITS FRESHNESS FILTER ON 2026-09-05.** Here freshness gates a stamp
 * whose subject the CALLER named and could have posed (F-589); there it decided
 * whether an agent EXISTS, which the projection's full-set replace already
 * answers. The own-scoped read behind `ownAgentIds` still filters — see this
 * file's report of 2026-09-05 for why that half was left to a ruling rather than
 * taken in the same pass.
 *
 * ⚠ **NO ROW ⇒ `delivery=none`, AND THAT IS THE RULE RATHER THAN A GAP.** An
 * agent talking to the room with nobody having addressed it inside the window is
 * a BROADCAST, and the standing "agent-authored unaddressed starts nobody" rule
 * holds for exactly that case.
 */
export async function reciprocalParty(
  channelId: string,
  input: ChannelMessageCreateInput,
  /** The metadata fold's OUTPUT — `session_id` is the server's own stamp, so
   *  the caller's copy has already been stripped. */
  metadata: Record<string, unknown>,
  now: number,
  /** The agent ids the AUTHOR'S OWN fresh sessions answer to, from
   *  `service-wake-verdict-handles.ts › ownLiveAgentIds`. The claim must name
   *  one. */
  ownAgentIds: readonly string[]
): Promise<string | null> {
  const authorAgentId = authorAgentIdOf({
    clientMsgId: input.clientMsgId,
    metadata,
  });
  if (authorAgentId === null) return null;
  if (!ownAgentIds.includes(authorAgentId)) return null;
  const sinceIso = new Date(now - RESILIENCE_WINDOW_MS).toISOString();
  const row = await repoMessages.findLastRoomAddressToAgent(
    channelId,
    authorAgentId,
    sinceIso
  );
  return row?.author_user_id ?? null;
}

/**
 * **RR3 — AN UNADDRESSED HUMAN MESSAGE IS ANSWERED BY ONE AGENT, DECIDED BY THE
 * ROOM.** Three arms, in order, and the third is a real answer:
 *
 *   1. the channel's configured **default responder**, if that handle is live;
 *   2. else **exactly one** live agent in the channel → it;
 *   3. else, with several live, the one that POSTED here most recently;
 *   4. else the one that LAUNCHED most recently.
 *   Nobody at all is answered only when the room holds NO live agent.
 *
 * ⚠ **ARM 1 DEGRADES INTO ARM 2 RATHER THAN FAILING.** The setting stores a
 * HANDLE and nothing enforces that it names a live session (the migration says
 * why: an FK to `agent_templates` would be a cross-visibility reference from a
 * row members can read). A responder that is not running is simply not the
 * answer today.
 *
 * ⚠ **ARM 2 IS WHY THE LLM TRIAGE LOOP GOES (B6).** `main/session-wake-tiers.js
 * › tierFor` collapses to `n === 1 ? SOLO : NONE`, and RR3 arm 2 IS solo —
 * computed here, once, for free, from the projection the server already holds.
 *
 * ⚠ **AN EMPTY ROOM IS NOT A FAILURE AND MUST NOT BECOME A REFUSAL.** Nobody was
 * named, so nothing was mis-addressed: this is a person talking to a room with
 * no agent in it. The refusal (`CHANNEL_RECIPIENT_UNRESOLVED`) belongs to a `to`
 * that named somebody who is not there — a different fact with a different
 * remedy.
 *
 * ⚠ **TWO LIVE AGENTS AND NO SETTING WAS "DELIBERATELY NOBODY" UNTIL 2026-09-04,
 * AND THAT WAS THE COMMON CASE WEARING AN EDGE CASE'S CLOTHES.** Row #966: a
 * person wrote in a room with two live agents and no default, the post stored
 * `verdict=none`, fed 0 of 2, and he re-sent it with a tag. Two live agents is
 * the ordinary shape of a multiplayer channel, and Samuel's ruling in the same
 * breath as the fan-out narrowing is that a forgotten `@` must never stall a
 * conversation. Arms 3 and 4 answer it, and the REASON is stamped so the
 * transcript can say why — see {@link ResponderReason}.
 *
 * ⚠ **ARM 3's READ IS LAZY.** Arms 1 and 2 settle the overwhelming majority of
 * rooms with no round trip at all; only a multi-agent room with no configured
 * responder pays for `listRecentRoomAgentPosts`.
 */
/**
 * ⚠ **THE RULE ITSELF MOVED TO `lib/agent-mentions.ts › resolveDefaultResponder`
 * ON 2026-09-02 (slice B10)**, and this is the row-shaped adapter over it. The
 * composer's recipient line has to predict THIS answer for an unsent draft, and
 * a client cannot import a `server-only` module — so the arms live where both
 * trees can read them and WHEN they are asked stays here. Nothing about the
 * behaviour changed; this function's own tests still drive it.
 */
export async function defaultResponder(
  channel: ChannelRow,
  sessions: readonly SessionStateRow[],
  /** Arm 3's input, fetched only if arms 1, 2 and 4's ordering leave it needed.
   *  A thunk rather than a value because the read is the arm's whole cost. */
  recent: () => Promise<string[]>
): Promise<ResponderChoice | null> {
  const candidates = launchOrder(sessions).map((row) => ({
    agentId: row.name,
    displayName: row.display_name,
  }));
  const settled = resolveDefaultResponder(
    channel.default_responder_agent_name,
    candidates
  );
  // ⚠ `most recently launched` IS THE ONLY ANSWER ARM 3 CAN IMPROVE ON — every
  // other reason means the room settled it without needing to know who spoke
  // last, so the read is not issued at all.
  if (settled === null || settled.reason !== "most recently launched") {
    return settled;
  }
  return resolveDefaultResponder(
    channel.default_responder_agent_name,
    candidates,
    await recent()
  );
}

/**
 * THE ROOM'S LIVE SESSIONS, **MOST RECENTLY LAUNCHED FIRST** — arm 4's ordering,
 * supplied here because {@link resolveDefaultResponder} deliberately orders
 * nothing itself.
 *
 * ⚠ **`started_at` IS THE DESKTOP'S OWN REPORT OF WHEN THE SESSION BEGAN, AND
 * `created_at` IS THE FALLBACK** — the row's first push, which is the closest
 * thing the server has for a build that reports no start. An unparseable or
 * absent pair sorts LAST rather than first: a session that cannot say when it
 * launched must not win a tie-break about which launched most recently.
 */
function launchOrder(
  sessions: readonly SessionStateRow[]
): readonly SessionStateRow[] {
  const at = (row: SessionStateRow): number => {
    const parsed = Date.parse(row.started_at ?? row.created_at ?? "");
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  return [...sessions].sort((a, b) => at(b) - at(a));
}

/**
 * ARM 3's ANSWER — **the agents THIS AUTHOR has addressed in this room**, most recent first
 * (Samuel, 2026-09-04), **with no time window at all** (Samuel, 2026-09-06).
 *
 * ⚠ **THE WINDOW WAS THE SECOND BUG, AND IT OUTLIVED THE FIRST BY TWO DAYS.** Both this walk and
 * the read under it were bounded by {@link RESILIENCE_WINDOW_MS}, so fifteen minutes after a person
 * tagged an agent their default fell through to arm 4 — *the most recently launched* — and the room
 * answered in a different voice with nothing they had done. The ruling: author stickiness has NO
 * expiry. The agent you last addressed stays the default until you address a different live agent,
 * or that agent ends; then the next-most-recent tag wins, and only then the arms below.
 * ⚠ **THE ONLY BOUND LEFT IS THE PAGE** — `RECENT_AGENT_POSTS_LIMIT` (50) rows of this author's own
 * main-room messages, newest `seq` first. It suffices because the walk stops at the FIRST id that
 * is still live: fifty of one person's own room posts is far more than the handful it takes to find
 * their last surviving tag, and a person whose last fifty room posts named no live agent has no
 * stickiness to honour — falling to arm 4 there is the correct answer, not a truncation.
 * ⚠ **THE WINDOW STILL BOUNDS THE OTHER ARMS.** RR2's `findLastRoomAddressToAgent` above keeps
 * `RESILIENCE_WINDOW_MS`, and so does `recentAgentPosters`: "who spoke here lately" is freshness
 * and goes stale; "who did this person address" is a habit and does not.
 *
 * ⚠ **IT WAS "who posted here last" UNTIL 2026-09-04, AND THAT IS THE BUG IT FIXES.** One agent
 * addressing another re-pointed the room's default responder, so the operator saw the answer wander
 * with nothing they had done. The rule is now stickiness PER PERSON: the agent you last tagged is
 * the one you are probably still talking to.
 *
 * ⚠ **THE RULE IS `lib/agent-post-stamp.ts › recentAgentsAddressedBy`, IMPORTED** — the composer
 * asks the same question of the transcript it is rendering, and a second spelling here is how the
 * recipient LINE comes to name one agent and the stored verdict another.
 *
 * ⚠ **THE WALK DOES NOT FILTER FOR LIVENESS AND MUST NOT.** It answers "who did they address"; the
 * resolver below intersects that with the live candidates, so an ENDED agent cannot eat the pick —
 * it is simply not a candidate and the next id in this list is tried. One rule in the resolver
 * rather than two half-rules in both places.
 */
export async function recentRoomAgents(
  channelId: string,
  /** The author whose habit is being read — the routed message's own author. */
  authorUserId: string,
  now: number
): Promise<string[]> {
  const rows = await repoMessages.listRecentRoomTagsBy(channelId, authorUserId);
  return recentAgentsAddressedBy(
    authorUserId,
    rows.map((row) => ({
      seq: Number(row.seq),
      createdAt: row.created_at,
      authorUserId: row.author_user_id,
      recipientAgentIds: row.recipient_agent_ids ?? null,
      metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    })),
    // ⚠ NO `windowMs` — see the header. `now` is still handed in rather than read, so the walk
    // stays a pure function of the write's own clock even though nothing bounds it by time.
    { now }
  );
}
