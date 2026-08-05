import "server-only";
import { DESKTOP_SESSION_RUNTIME } from "@/shared/auth/runtime-header";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelRow, ChannelTaskRow } from "./dto";
import { ChannelTaskNotInChannelError, TaskForbiddenError } from "./errors";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import { resolveAgentAddressing } from "./service-writes-agents";
// The thread half — who may write into a thread (both id shapes) and what the
// thread row says about accepting the post — is its own module (§2 split).
import {
  isLegacyThreadParticipant,
  isThreadClosed,
  mayWriteThread,
} from "./service-writes-metadata-thread";
import type { ChannelContext } from "./service-shared";

/**
 * The ONE place that decides what lands in `channel_messages.metadata`. Split
 * out of `service-writes.ts` (§2 cap) because it is its own reason to change:
 * the reserved-key anti-spoof fold, DM auto-addressing, and the task-key
 * stamping all answer the same question — what may a caller put in metadata,
 * and what does the server stamp itself.
 *
 * Reserved keys (`to_user_id`, `summary`, `runtime`, `appVersion`,
 * `session_id`, `taskMode`,
 * `taskCreatedBy`, `taskTitle`, `taskTarget`, `to_agent_id`, `to_agent_ids`,
 * `author_agent_id`, `intent`,
 * and the five calm-terminal flags) are ALWAYS stripped from caller metadata
 * and re-added only from server-validated values. `taskId` stays
 * caller-settable — but EVERY thread id, first-class or legacy, now has to
 * BELONG to the poster (see {@link resolvePostMetadata}).
 *
 * The THREAD half — `mayWriteThread`, `isLegacyThreadParticipant` and the
 * closed-status read — moved to `service-writes-metadata-thread.ts` at the §2
 * cap when the session stamp and the closed-thread notice landed (F2 + F6).
 *
 * **The legacy gate is CLOSED (F-083 bullet 3 / audit Q10, 2026-07-31).** A
 * non-UUID `task-{channelId}-{seq}` id used to skip the participation check
 * entirely and be stored verbatim, so any channel member could stamp another
 * pair's exchange onto their own message and have it render inside that pair's
 * card (and, with a lifecycle kind, flip its outcome). It is now validated
 * against the same opening-request pair the calm flags use, and a caller who
 * is not one of the two parties has the tag SILENTLY STRIPPED — the message
 * still posts, untagged. Strip and not 403 is deliberate and is the plan's
 * recorded decision (`docs/MULTIPLAYER-PLAN.md`, "judgment calls"): installed
 * desktop 1.7.16 posts legacy ids for its lifecycle events, some against
 * pre-v1.6 openers that carry no `to_user_id` at all, and a hard refusal there
 * would reject real posts from a build already in the field. The first-class
 * (UUID) branch keeps its 403: those ids only ever come from a caller that
 * chose them, and an invisible un-threading is worse than an error.
 *
 * Consequence for the DESKTOP lane (do not do it here): the two-party session
 * history fence — `pairRows` in `session-history.js` — was blocked on exactly
 * this gate (ENGINEERING §8, "close the legacy-id gate FIRST, then widen"). It
 * is now UNBLOCKED; widening it is the desktop lane's later work.
 */

/**
 * The calm-terminal flags a `task_failed` may carry (`declined`, `dropped`,
 * `interrupted`, `capped`, `ended` — see `lib/group-thread.ts`). They decide
 * whether the other side's card reads as a calm, operator-chosen ending or a
 * red failure, and the message receipt shows Declined / Interrupted off the
 * same bits. Reserved, because a member who could set them on someone else's
 * thread could fabricate that thread's outcome ("This request was declined.")
 * without ever touching the session it describes.
 */
const CALM_FLAG_KEYS = [
  "declined",
  "dropped",
  "interrupted",
  "capped",
  "ended",
  // P1-7 (2026-08-04) — THE NON-TERMINAL SESSION END. `session_ended` rides on a
  // `task_progress`, not a `task_failed`, and it is reserved on exactly the same
  // terms as its five siblings: it changes how the other member's card READS
  // ("their session stopped", not "the thread failed"), so a member who could
  // set it on somebody else's thread could narrate that thread's state without
  // touching the session it describes. It is NOT read by `calmTerminalStatus` —
  // that function answers only for a `task_failed` — which is the point: a local
  // session ending is not an outcome for the shared thread at all.
  "session_ended",
] as const;

/**
 * The other member of a DIRECT channel, or undefined when it cannot be
 * resolved unambiguously. A DM is exactly two members (enforced when it opens,
 * immutable afterwards), so any other shape — a torn-down roster, an
 * unexpected third row — is ambiguous and resolves to nothing rather than
 * guessing at an addressee. The peer is read OFF the channel roster, the same
 * table the explicit `to` path validates against, so an auto-addressed peer
 * satisfies the v1.1 addressee-is-an-active-member rule by construction.
 */
async function resolveDirectPeer(
  channel: ChannelRow,
  authorUserId: string
): Promise<string | undefined> {
  if (!channel.is_direct) return undefined;
  const members = await repo.listMembers(channel.id);
  if (members.length !== 2) return undefined;
  const peers = members.filter((m) => m.user_id !== authorUserId);
  if (peers.length !== 1) return undefined;
  return peers[0].user_id;
}

/**
 * The single OPEN task of a direct channel whose two participants are exactly
 * {author, peer}, or null. Deliberately all-or-nothing: with 0 candidates
 * there is nothing to thread into, and with 2+ the reply could belong to
 * either, so guessing would attach a turn to the wrong task card (and route it
 * to the wrong session window on the peer's machine).
 */
async function resolveInheritableTask(
  channel: ChannelRow,
  authorUserId: string,
  peerUserId: string
): Promise<ChannelTaskRow | null> {
  const tasks = await repoTasks.listTasksByChannel(channel.id);
  const candidates = tasks.filter(
    (task) =>
      task.status === "open" &&
      ((task.created_by === authorUserId &&
        task.target_user_id === peerUserId) ||
        (task.created_by === peerUserId &&
          task.target_user_id === authorUserId))
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Strip every calm-terminal flag from caller metadata and report which ones
 * were asked for. Only a literal `true` counts — a truthy-but-not-true value
 * (`"yes"`, `1`) is dropped and never re-stamped, so the wire can only ever
 * carry the strict booleans the renderers read (`=== true`).
 */
function takeCalmFlags(
  metadata: Record<string, unknown>
): Array<(typeof CALM_FLAG_KEYS)[number]> {
  const requested: Array<(typeof CALM_FLAG_KEYS)[number]> = [];
  for (const key of CALM_FLAG_KEYS) {
    if (metadata[key] === true) requested.push(key);
    delete metadata[key];
  }
  return requested;
}

/**
 * What a post's metadata fold produced: the stored `metadata` itself, plus the
 * one NOTICE the fold is in a position to raise and nothing downstream could
 * re-derive without a second query.
 *
 * F6 — `threadClosed` is the whole reason this is an object rather than a bare
 * record. The thread row is resolved here and nowhere else on the write path, so
 * this is the only place that can see a post landing in a CLOSED thread. It
 * rides OUT as a notice rather than being stamped INTO `metadata`: the message
 * is not different for having been posted late, only the caller's report is.
 */
export interface PostMetadataResult {
  metadata: Record<string, unknown>;
  /** True when the post landed in a thread whose row is no longer open. */
  threadClosed: boolean;
}

/**
 * The keys a CLOSE PROPOSAL stamps (DECISION 2, 2026-08-04). Reserved on the
 * same terms as `runtime` / `session_id`: stripped from caller metadata
 * unconditionally and re-stamped ONLY from a server-internal value, because a
 * caller that could set them would be able to raise a "your agent thinks this
 * can be closed — Close?" prompt on a thread it is not a party to, in front of a
 * human whose one click then settles the exchange for both members.
 *
 * Two keys rather than one because the prompt has to prefill the outcome the
 * agent is proposing: `closeProposed` is the marker the surfaces match on, and
 * `closeOutcome` is what the confirm hands straight back to `closeTask`.
 */
export const CLOSE_PROPOSAL_KEYS = ["closeProposed", "closeOutcome"] as const;

/**
 * The server-internal inputs to the metadata fold — values no HTTP caller can
 * supply, because they are not fields of `ChannelMessageCreateInput` and no
 * route parses them.
 */
export interface PostMetadataOptions {
  /**
   * Stamp this post as a CLOSE PROPOSAL carrying that outcome. The one caller is
   * `service-tasks.proposeTaskClose`, which has already checked that the poster
   * is the thread's creator or its target.
   */
  closeProposal?: "completed" | "failed";
}

/**
 * Build the stored `metadata` for a post. `input.toUserId` must ALREADY have
 * passed the addressee-is-a-channel-member check (the caller runs it, so a bad
 * addressee 400s before the idempotency short-circuit).
 *
 * The server-owned folds, in order:
 *
 * 1. **Anti-spoof strip (v1.1).** `to_user_id` / `summary` are settable ONLY
 *    via the validated top-level fields: a raw metadata copy would bypass both
 *    the addressee-membership check and the schema's summary length cap
 *    (consent-prompt spoofing on non-members).
 * 1b. **Intent (chat vs. request).** `intent` is reserved and re-stamped only
 *    from the validated top-level field, and it is stamped ONLY WHEN THE CALLER
 *    SUPPLIED IT — an absent field stamps no key at all, so every existing
 *    caller's metadata is byte-for-byte what it was. `chat` is the whole reason
 *    the field exists: it turns fold (2) OFF, so two humans can talk in a DM
 *    without each line poking the other's machine. It is stamped rather than
 *    merely acted on because the receiving side has to be able to tell a
 *    deliberately-unaddressed CHAT from a message that simply forgot to
 *    address — the first is not a delivery failure and must never be repaired
 *    as one.
 * 2. **DM auto-address.** In a DIRECT channel with no caller `to`, the peer is
 *    stamped as `to_user_id`. The MCP `post` path could not be relied on to
 *    pass `to`, and an UNADDRESSED agent message is deliberately ignorable on
 *    the receiving desktop (the v1.3.1 loop brake) — so a legitimate DM reply
 *    was posted successfully and then never delivered. Addressing is what the
 *    web composer already does for a DM (v1.6); doing it server-side means the
 *    model cannot forget the parameter. NEVER auto-addressed in a non-direct
 *    channel: with 3+ members the intended recipient is ambiguous, and a wrong
 *    guess would prompt the wrong operator. **SKIPPED ENTIRELY under
 *    `intent:"chat"`** — the peer is not even resolved, so nothing downstream
 *    can fall back to it. That is the operator's report ("if I send a message
 *    it's just going as a message to the channel... doesn't prompt an agent")
 *    made true, without giving back the delivery guarantee a `request` needs.
 *    **A chat post that ADDRESSES AGENTS still stamps `to_user_id` — from the
 *    OWNER BRIDGE in (4b), never from the peer.** The two are not the same
 *    fallback: the bridge names the machine an explicitly-named agent runs on,
 *    which is the whole point of naming it, while the peer fallback is the guess
 *    chat exists to suppress. So `@quartz` in a DM reaches quartz's owner and
 *    stops there, and an untagged aside in the same DM reaches nobody.
 * 3. **Task keys.** The reserved four are stripped and re-stamped from the
 *    resolved task row, so `taskMode` reflects the latest `set_task_mode` and
 *    cannot be spoofed. `taskId` itself stays caller-settable (a responder
 *    legitimately replies within a task); a UUID that resolves to no task in
 *    THIS channel is rejected (v1.7 server-validated threading), while a
 *    legacy `task-<uuid>-<seq>` id never resolves to a row and so stamps none
 *    of the four (a legacy card renders titleless — that is the tell, and the
 *    MCP surface says so). A caller-supplied taskId also SUPPRESSES
 *    inheritance — an explicit thread (or an explicit legacy id) is the
 *    caller's decision.
 *    Inheritance only fires for a plain `message` in a DM addressed to the
 *    peer: it exists so a session reply reaches the requester's waiting window
 *    (the desktop routes by taskId), and stamping a task id onto a lifecycle
 *    marker would let an unrelated `task_failed` land on that task's card.
 * 4. **Thread participation (v2.9; legacy half closed 2026-07-31).** Resolving
 *    in this channel is not enough: in a 3+ member channel every member can
 *    read every thread id, and a stamped `taskId` is what puts a message inside
 *    that thread's card AND routes it to the responder's session window. So a
 *    caller-supplied id must belong to the poster, and the two id shapes fail
 *    DIFFERENTLY on purpose:
 *    - **First-class (UUID):** must be `created_by` / `target_user_id` of the
 *      resolved task, else the post is REFUSED (403), not silently unthreaded —
 *      a message the author believes landed in a thread and the recipient never
 *      sees is the invisible-delivery failure this whole feature exists to
 *      prevent. Closing and reopening were already gated this way.
 *    - **Legacy (`task-<channelId>-<seq>`):** validated by
 *      {@link isLegacyThreadParticipant} — this channel's id, a positive seq,
 *      and a poster inside the opener's {author, to_user_id} pair, either
 *      direction. Anything else (a foreign channel's id, a malformed seq, a
 *      missing or unaddressed opener, another pair's exchange) has the tag
 *      STRIPPED and the post proceeds untagged. It NEVER throws: the installed
 *      desktop posts legacy ids for lifecycle events and a 403 would break it.
 *      Stripping never blocks the post — the message stays visible and
 *      attributable, it simply stops landing in a thread that is not the
 *      poster's.
 *    Inherited ids need no check — inheritance only resolves a task whose
 *    participants are {author, peer} by construction.
 *    **Multiplayer:** the first-class check is now {@link mayWriteThread}, not
 *    the bare pair test. A thread with rows in `channel_task_participants` is a
 *    BREAKOUT ROOM and its SET decides (the original pair stays valid); a
 *    thread with no rows keeps the pair gate exactly as it was. What makes that
 *    safe is the CURATION RULE on the set itself (`service-participants.ts`) —
 *    only the thread's creator, its target, or an existing user participant may
 *    add a row — so a bystander cannot manufacture a set to be admitted by.
 * 4b. **Agent addressing (multiplayer).** `to_agent_ids`, `to_agent_id` and
 *    `author_agent_id` join the reserved set: stripped from caller metadata
 *    unconditionally, then re-stamped only from the validated top-level
 *    `toAgent` / `toAgents` / `authorAgentId` fields
 *    (`service-writes-agents.ts` owns that validation — an agent of another
 *    channel is a 400, another member's agent as AUTHOR is a 403, and EVERY
 *    addressed agent's owner must be a member).
 *    **`to_agent_ids` is the address; `to_agent_id` is a COMPAT MIRROR of its
 *    head** — installed desktop 1.7.17 reads only the scalar, so a
 *    multi-address has to keep saying something it understands. Addressing an
 *    agent ALSO stamps the FIRST one's owner as `to_user_id`: the v1 bridge to
 *    the existing delivery path, since the listener triggers on the addressed
 *    user and the agent runs on that user's machine. The message's
 *    `author_user_id` is untouched — an agent id supplements an author, it
 *    never replaces one.
 * 5. **Runtime stamp (WAKE-V1).** `runtime` is reserved: stripped from caller
 *    metadata unconditionally, then re-stamped as `desktop-session` only when
 *    the REQUEST carried `X-Dopl-Runtime: desktop-session` (resolved by the
 *    auth layer into `ctx.runtime`). Absent header → no key at all, which is
 *    what an external agent's message looks like. This is the single stamping
 *    point precisely because the desktop reads the key to decide whether to
 *    open a requester window: a caller that could set it in `metadata` could
 *    make its own external post masquerade as a desktop session.
 * 6. **App-version stamp (Q10).** `appVersion` is reserved on exactly the same
 *    terms as `runtime`: stripped from caller metadata unconditionally, then
 *    re-stamped only from the REQUEST's `X-Dopl-App-Version` header (resolved
 *    by the auth layer into `ctx.appVersion`, and shape-checked there). Absent
 *    header → no key at all, which is what every non-desktop poster looks like.
 *    It exists because electron-updater installs on QUIT and a background
 *    listener never quits, so a peer can run a stale build indefinitely with
 *    nothing on either machine saying so — a shipped fix then reads as broken.
 *    Purely diagnostic: nothing may gate on it (see `app-version-header.ts`).
 * 6b. **Session stamp (F2).** `session_id` joins the reserved set on EXACTLY
 *    the terms `runtime` and `appVersion` are on: stripped from caller metadata
 *    unconditionally, then re-stamped only from the REQUEST's
 *    `X-Dopl-Session-Id` header (resolved by the auth layer into
 *    `ctx.sessionId`, and shape-checked there). Absent header → no key at all.
 *    It exists because ONE `channel_agents` row can be claimed by any number of
 *    concurrent processes holding the owner's credential — `as_agent` is
 *    per-call and ownership-checked only, and on the desktop a ROOM slot
 *    `(channel, agent)` and a PAIR slot `(channel, thread)` are disjoint by
 *    design, so three live sessions of one handle is the documented behavior.
 *    With nothing on the wire naming a session, "flint said X" was not a
 *    well-formed statement, and two sessions of one handle issued a peer
 *    contradictory instructions 79 seconds apart with no way to attribute
 *    either. A LABEL, NOT A LOCK: nothing here enforces one live session per
 *    agent id, which would break the three-slot design and would not touch an
 *    external CLI session passing `as_agent` at all.
 * 7. **Calm-terminal flags (v2.9).** Stripped like any reserved key and
 *    re-stamped only when the post ends up carrying a thread tag the poster is
 *    entitled to — which, since (4), is exactly "a `taskId` survived". Both
 *    shapes are already decided by then, so the flags need no check of their
 *    own and cost no second read. A flag on a thread that is not the poster's
 *    is dropped with the tag that carried it, so the victim's card keeps
 *    rendering the outcome its OWN session produced.
 * 8. **Closed-thread notice (F6).** The resolved thread row's `status` is READ
 *    at last — it was written on close and cleared on reopen and consulted
 *    nowhere on the write path, so a closed thread accepted posts in silence.
 *    It changes NOTHING about the message: the post lands, the metadata is
 *    identical, and the fact rides out on {@link PostMetadataResult} for the
 *    caller's report. See {@link isThreadClosed} for why this warns instead of
 *    refusing.
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput,
  opts: PostMetadataOptions = {}
): Promise<PostMetadataResult> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  // DECISION 2 — the close-proposal keys are stripped BEFORE anything decides
  // whether a stamp is coming, exactly like `session_id` below. See
  // {@link CLOSE_PROPOSAL_KEYS}.
  for (const key of CLOSE_PROPOSAL_KEYS) delete metadata[key];
  delete metadata.to_user_id;
  delete metadata.summary;
  delete metadata.runtime;
  delete metadata.appVersion;
  delete metadata.to_agent_id;
  delete metadata.to_agent_ids;
  delete metadata.author_agent_id;
  delete metadata.intent;
  // F2 — stripped UNCONDITIONALLY, before anything decides whether a stamp is
  // coming. A caller that could set this could attribute its own post to
  // somebody else's session, which is the exact forensic question the key
  // exists to answer.
  delete metadata.session_id;
  const calmFlags = takeCalmFlags(metadata);

  // Stamped only when the caller SUPPLIED it. An absent field stamps no key —
  // the wire an existing caller produces is unchanged, and absence reads as
  // `request`, the same discipline `runtime` gets one fold down.
  if (input.intent) metadata.intent = input.intent;

  // Server-stamped from the request's own header, never from the payload.
  if (ctx.runtime === DESKTOP_SESSION_RUNTIME) {
    metadata.runtime = DESKTOP_SESSION_RUNTIME;
  }
  if (ctx.appVersion) metadata.appVersion = ctx.appVersion;
  // F2, same rule again: the header or nothing. Stamped verbatim — the value is
  // the caller's own slot key and the server has no opinion about its content
  // beyond the shape check `session-header.ts` already applied.
  if (ctx.sessionId) metadata.session_id = ctx.sessionId;

  // Both agent identities are validated before anything is stamped: a
  // `toAgent` that names no agent of this channel is a 400, and an
  // `authorAgentId` the caller does not own is a 403.
  const agents = await resolveAgentAddressing(ctx, channel.id, input);
  if (agents.authorAgentId) metadata.author_agent_id = agents.authorAgentId;
  if (agents.toAgentIds) metadata.to_agent_ids = agents.toAgentIds;
  // COMPAT MIRROR of `to_agent_ids[0]`, not a second address. Installed desktop
  // 1.7.17 reads only this key and `to_user_id`; drop it once every desktop in
  // the field routes on the array (see `service-writes-agents.ts`).
  if (agents.toAgentId) metadata.to_agent_id = agents.toAgentId;

  // CHAT never resolves a peer at all. Not "resolves one and discards it" — the
  // fallback below reads whatever `peerUserId` holds, so the only way a chat
  // post can never be auto-addressed is for there to be nothing to fall back to.
  const peerUserId =
    input.intent === "chat"
      ? undefined
      : await resolveDirectPeer(channel, ctx.userId);
  // THE OWNER BRIDGE (v1). An addressed agent's OWNER is stamped as
  // `to_user_id`, because that is still the only thing the delivery path reads:
  // the desktop listener triggers on the addressed USER, and the agent runs on
  // that user's machine. Without it a `@quartz` post would carry a perfectly
  // valid `to_agent_id` and wake nobody. It takes precedence over an explicit
  // `toUserId` because a handle names ONE machine unambiguously while a
  // disagreeing pair of addressees names none. Remove this line only once the
  // listener routes on `to_agent_id` directly (the desktop lane's later work).
  const toUserId = agents.toAgentOwnerUserId ?? input.toUserId ?? peerUserId;
  if (toUserId) metadata.to_user_id = toUserId;
  if (input.summary) metadata.summary = input.summary;

  delete metadata.taskMode;
  delete metadata.taskCreatedBy;
  delete metadata.taskTitle;
  delete metadata.taskTarget;

  const callerTaskId =
    typeof metadata.taskId === "string" && metadata.taskId.trim().length > 0
      ? metadata.taskId
      : undefined;
  // A blank or non-string tag is not a thread id. Dropping it here is what
  // lets everything below read `metadata.taskId` as "an ACCEPTED thread tag".
  if (!callerTaskId) delete metadata.taskId;

  let task: ChannelTaskRow | null = null;
  if (callerTaskId) {
    if (isUuid(callerTaskId)) {
      task = await repoTasks.findTaskByChannelAndId(channel.id, callerTaskId);
      if (!task) throw new ChannelTaskNotInChannelError(callerTaskId);
      // Membership in the channel is not membership in the THREAD.
      if (!(await mayWriteThread(task, ctx.userId, agents.authorAgentId))) {
        throw new TaskForbiddenError("post into this task");
      }
    } else if (
      !(await isLegacyThreadParticipant(channel.id, callerTaskId, ctx.userId))
    ) {
      // Q10 / F-083 bullet 3: a legacy id that is not the poster's own
      // exchange is stripped, never refused — the post lands untagged. Silent
      // to the wire by design: there is no diag lane on this path, and the
      // installed desktop that sends these ids has nowhere to show one.
      delete metadata.taskId;
    }
  } else if (
    peerUserId &&
    toUserId === peerUserId &&
    (input.kind ?? "message") === "message"
  ) {
    task = await resolveInheritableTask(channel, ctx.userId, peerUserId);
    if (task) metadata.taskId = task.id;
  }

  if (task) {
    metadata.taskMode = task.mode;
    metadata.taskCreatedBy = task.created_by;
    metadata.taskTitle = task.title;
    // A null target (an unaddressed task) stamps nothing — the desktop's
    // suppression predicate then cannot match and falls through to the
    // trigger rules.
    if (task.target_user_id) metadata.taskTarget = task.target_user_id;
  }

  // Re-stamp the calm-terminal flags only for the thread's own participants —
  // which is now the same question as "did a thread tag survive the gate
  // above". A first-class id got there by passing the 403 gate (or by
  // inheritance, whose pair is {author, peer} by construction), a legacy id by
  // matching its opener's pair. Anything else (a foreign thread, an
  // unresolvable id, no thread at all) has no `taskId` left and keeps the
  // strip, so a fabricated outcome has nothing to attach to.
  if (calmFlags.length > 0 && typeof metadata.taskId === "string") {
    for (const key of calmFlags) metadata[key] = true;
  }

  // DECISION 2 — the close proposal, stamped on the SAME condition the calm
  // flags are: only onto a thread tag that survived the gate above. Belt and
  // braces (`proposeTaskClose` already checked creator-or-target before calling
  // us), and the belt is what makes "a prompt to close this thread" unforgeable
  // rather than merely unforged today.
  if (opts.closeProposal && typeof metadata.taskId === "string") {
    metadata.closeProposed = true;
    metadata.closeOutcome = opts.closeProposal;
  }

  // F6 — the notice, read off the row the folds above already resolved. An
  // INHERITED task can never be closed (`resolveInheritableTask` filters to
  // `open`), so in practice this fires only for a caller-supplied first-class
  // id — the exact shape of "I closed this thread and kept posting into it".
  return { metadata, threadClosed: isThreadClosed(task) };
}
