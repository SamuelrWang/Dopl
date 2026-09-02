import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelMemberRow, ChannelRow, ChannelTaskRow } from "./dto";
import { ChannelTaskNotInChannelError, TaskForbiddenError } from "./errors";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import {
  isLegacyThreadParticipant,
  isThreadParticipant,
} from "./service-writes-metadata-thread";
import { takeCalmFlags } from "./service-writes-metadata-markers";
import { resolveBodyMentions } from "./service-writes-metadata-mentions";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import {
  ESCALATION_ANSWER_METADATA_KEY,
  ESCALATION_METADATA_KEY,
} from "../escalation";
import {
  resolveEscalation,
  resolveEscalationAnswer,
} from "./service-writes-metadata-escalation";
import type { ChannelContext } from "./service-shared";

/**
 * ONE place that decides what lands in `channel_messages.metadata`.
 *
 * RESERVED KEYS — always stripped from caller metadata, re-added only from
 * server-validated values: `to_user_id`, `summary`, `runtime`, `appVersion`,
 * `session_id`, `to_user_notify`, `taskMode`, `taskCreatedBy`, `taskTitle`,
 * `taskTarget`, `to_agent_id`, `to_agent_ids`, `author_agent_id`, `intent`,
 * `handoff`, `fanoutGroup`, `mentionedUserIds`, `escalation`,
 * `escalationAnswer`, and the six calm-terminal flags. ⚠ The two close-proposal keys and `threadReopened` LEFT this list with
 * thread closing (wiring plan Phase 4, 2026-08-18) — no writer and, unlike the
 * dead agent keys below, no RENDERER either.
 * `service-writes-metadata-markers.ts` records why. `taskId` stays
 * caller-settable, but every thread id — first-class or legacy — must BELONG to
 * the poster (see {@link resolvePostMetadata}). Marker keys live in
 * `service-writes-metadata-markers.ts`, the thread half in
 * `service-writes-metadata-thread.ts`.
 *
 * ⚠ The three agent keys have no writer left but MUST stay in the strip list:
 * `author_agent_id` is what the transcript reads to attribute an old message to
 * a handle, so a caller who could set it could attribute its own words to
 * somebody's retired agent. Stored rows keep theirs and keep rendering.
 * ⚠ **AND THEY ARE NOT THE `toAgent` / `authorAgentId` ROUTE TOMBSTONES, WHICH
 * WERE DELETED ON 2026-09-02.** Those were parameters with a delete-me clock;
 * these are reserved NAMES, and dropping one is a widening, not a cleanup. The
 * two are named together in one v2 spec row, which is what **F-434** exists to
 * separate — read it before deleting anything here.
 */

/**
 * Other member of a DIRECT channel, or undefined when ambiguous. A DM is exactly
 * two members; any other shape resolves to nothing rather than guessing.
 *
 * ⚠ ITS ONLY SURVIVING READER IS THREAD INHERITANCE. Until 2026-08-18 this also
 * fed DM AUTO-ADDRESS — a DM post with no caller `to` was stamped with the peer
 * — and that fallback is RETIRED (wiring plan Phase 3). Addressing is now
 * explicit at every member count, in every channel shape: a post with no `to`
 * addresses nobody, and nobody's agent is started by it. Do not reinstate the
 * fallback here; the "New agent thread" panel is the one surface that raises an
 * agent request, and it always names its addressees.
 *
 * ⚠ TAKES THE ROSTER AS A MEMOIZED LOADER rather than reading it. Mention
 * resolution (fold 9) needs the same rows, and a post that needs both must pay
 * for ONE `channel_members` read, not two — see the loader in
 * {@link resolvePostMetadata}.
 */
async function resolveDirectPeer(
  channel: ChannelRow,
  authorUserId: string,
  roster: () => Promise<ChannelMemberRow[]>
): Promise<string | undefined> {
  if (!channel.is_direct) return undefined;
  const members = await roster();
  if (members.length !== 2) return undefined;
  const peers = members.filter((m) => m.user_id !== authorUserId);
  if (peers.length !== 1) return undefined;
  return peers[0].user_id;
}

/**
 * Single task of a direct channel whose participants are exactly {author, peer},
 * else null. All-or-nothing: with 2+ candidates a guess would attach a turn to
 * the wrong card and route it to the wrong session window on the peer's machine.
 *
 * ⚠ THE `status === "open"` FILTER IS GONE (wiring plan Phase 4, 2026-08-18).
 * Threads do not close, so the only rows it could ever exclude are legacy ones
 * closed before the removal — and excluding those makes a pair with one old
 * thread inherit nothing, which reads as inheritance being broken. The column is
 * legacy and unread; this was one of its readers.
 */
async function resolveInheritableTask(
  channel: ChannelRow,
  authorUserId: string,
  peerUserId: string
): Promise<ChannelTaskRow | null> {
  // ⚠ Reads the ACTIVITY-ordered page (the one thread read there is). Order is
  // irrelevant here — this is an all-or-nothing match, not a pick-the-first —
  // and the bound is not a risk on this path: it runs only for a DIRECT
  // channel, i.e. one pair's threads.
  const { rows: tasks } = await repoTasks.listTasksByChannel(channel.id);
  const candidates = tasks.filter(
    (task) =>
      (task.created_by === authorUserId &&
        task.target_user_id === peerUserId) ||
      (task.created_by === peerUserId && task.target_user_id === authorUserId)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Stored `metadata`.
 *
 * ⚠ IT CARRIED A SECOND FIELD, `threadClosed`, until thread closing was removed
 * (wiring plan Phase 4, 2026-08-18): the thread row is resolved here and nowhere
 * else on the write path, so this was the only place that could see a post
 * landing in a closed thread, and the notice rode out to the caller (and into the
 * MCP `post` result). With no closer left, the only threads it could ever fire on
 * are legacy ones — the column is unread now, so the notice went with it.
 */
export interface PostMetadataResult {
  metadata: Record<string, unknown>;
}

/**
 * Server-internal inputs to the metadata fold — no HTTP caller can supply
 * these; they are not fields of `ChannelMessageCreateInput` and no route parses
 * them.
 *
 * ⚠ TWO OPTIONS ENDED HERE with thread closing (Phase 4, 2026-08-18):
 * `closeProposal` (stamped the close-proposal marker keys for the deleted
 * `proposeTaskClose`) and `reopened` (stamped `threadReopened` for the deleted
 * `reopenTask`).
 */
export interface PostMetadataOptions {
  /**
   * Stamp reserved `metadata.handoff` true. Only caller:
   * `service-tasks.createTask`, forwarding validated `TaskCreateInput.handoff`.
   * ⚠ Reserved on the runtime stamp's terms — desktop reads it to decide whether
   * to open a requester window, so it must never be caller-settable.
   */
  handoff?: boolean;
  /**
   * Stamp reserved `metadata.fanoutGroup` with this id. Only caller:
   * `service-tasks-fanout.ts › createTaskFanOut` (through
   * `service-tasks.ts › createTask`), which derives it server-side from the
   * channel, the creator and the validated base idempotency key.
   *
   * ⚠ Reserved on the handoff stamp's terms — the transcript renders every
   * opening message sharing a group id as ONE card, so a caller able to set it
   * could splice its own thread into somebody else's request.
   */
  fanoutGroupId?: string;
}

/**
 * Build the stored `metadata` for a post. ⚠ `input.toUserId` must ALREADY have
 * passed the addressee-is-a-channel-member check — the caller runs it, so a bad
 * addressee 400s before the idempotency short-circuit.
 *
 * Server-owned folds, in order:
 *
 * 1. **Anti-spoof strip.** `to_user_id` / `summary` settable ONLY via the
 *    validated top-level fields — a raw metadata copy bypasses both the
 *    addressee-membership check and the schema's summary cap.
 * 1b. **Intent.** Stamped only when supplied; absent stamps no key. `chat`
 *    turns fold (2) OFF. Stamped rather than merely acted on so the receiving
 *    side can tell a deliberate CHAT from a message that forgot to address, and
 *    never "repairs" it as a delivery failure.
 * 2. **Addressing is EXPLICIT, at every channel shape.** `metadata.to_user_id`
 *    comes from the validated `input.toUserId` and from nowhere else. ⚠ The DM
 *    auto-address fallback (direct channel + no caller `to` → stamp the peer)
 *    was RETIRED 2026-08-18: a post that names nobody reaches nobody's agent, in
 *    a DM exactly as in a group channel. `resolveDirectPeer` survives for fold
 *    (3) — thread inheritance — and `intent:"chat"` still skips it, so a chat
 *    post never inherits an open thread either.
 * 3. **Task keys.** Reserved four stripped and re-stamped from the resolved task
 *    row, so `taskMode` reflects the latest `set_task_mode` and can't be
 *    spoofed. `taskId` stays caller-settable: a UUID resolving to no task in
 *    THIS channel is rejected; a legacy `task-<uuid>-<seq>` resolves to no row
 *    and stamps none of the four (titleless card is the tell). A caller
 *    `taskId` SUPPRESSES inheritance; inheritance fires only for a plain
 *    `message` in a DM addressed to the peer, since a task id on a lifecycle
 *    marker would land an unrelated `task_failed` on that task's card.
 * 4. **Thread participation.** ⚠ Resolving in this channel is NOT enough — any
 *    member can read any thread id, and a stamped `taskId` puts the message
 *    inside that thread's card AND routes it to the responder's session window.
 *    The two id shapes fail differently on purpose:
 *    - First-class (UUID): must be `created_by` / `target_user_id`, else 403
 *      ({@link isThreadParticipant}). ⚠ Refused, never silently unthreaded — a
 *      message the author believes landed and the recipient never sees is the
 *      invisible-delivery failure this feature exists to prevent.
 *    - Legacy (`task-<channelId>-<seq>`): {@link isLegacyThreadParticipant} —
 *      this channel's id, positive seq, poster inside the opener's
 *      {author, to_user_id} pair, either direction. Anything else has the tag
 *      STRIPPED and posts untagged. ⚠ NEVER throws: installed desktop posts
 *      legacy ids for lifecycle events, some against openers with no
 *      `to_user_id` at all, and a 403 would reject real posts from the field.
 *    Inherited ids need no check — their pair is {author, peer} by construction.
 * 5. **Runtime stamp.** Stripped unconditionally, re-stamped from `ctx.runtime`
 *    (auth layer resolved it from `X-Dopl-Runtime` and bounded it by the
 *    credential via `narrowRuntime`). Two values reach here: `desktop-session`
 *    and `desktop-ui` (SESSION credential only; agent tokens refused upstream).
 *    ⚠ No recognized header → no key, which is what stops an external MCP post
 *    from opening anything on the sender's machine. Single stamping point
 *    because desktop reads the key to decide whether to open a requester window.
 * 6. **App-version stamp.** Same terms, from `X-Dopl-App-Version` (via
 *    `ctx.appVersion`). Exists because electron-updater installs on QUIT and a
 *    background listener never quits, so a peer can run a stale build forever.
 *    ⚠ Purely diagnostic — nothing may gate on it (see `app-version-header.ts`).
 * 6b. **Session stamp.** `session_id` from `X-Dopl-Session-Id`. One account's
 *    credential can be held by any number of concurrent sessions, so "the agent
 *    said X" was not well-formed. ⚠ A LABEL, NOT A LOCK — nothing enforces one
 *    live session; a session sending no header is simply unattributed.
 * 7. **Calm-terminal flags.** Re-stamped only when a thread tag the poster is
 *    entitled to survived (4); a flag on a foreign thread drops with its tag.
 *
 * ⚠ Folds 7b (the `threadReopened` marker) and 8 (the closed-thread notice read
 * off the resolved row's `status`) were DELETED with thread closing (wiring plan
 * Phase 4, 2026-08-18).
 * 9. **Mentions.** `mentionedUserIds` stripped unconditionally and re-stamped
 *    ONLY from the server's own parse of `input.body` against this channel's
 *    roster (`service-writes-metadata-mentions.ts › resolveBodyMentions`, over
 *    the one parser in `lib/mentions.ts`). ⚠ Reserved on `fanoutGroup`'s terms:
 *    the set decides whose Tags inbox a message lands in and Phase 7 gates
 *    NOTIFICATIONS on it, so a caller-settable value is a notification-forgery
 *    primitive. ⚠ NOT an addressing key and NOT gated on a thread tag — a
 *    mention in a plain channel post counts, and it still triggers nobody's
 *    agent. Stamped only when the set is non-empty, so no existing row shape
 *    moves.
 * 10. **Escalation.** `escalation` stripped unconditionally and re-stamped only
 *    from the validated `input.escalation` field. Reserved on `fanoutGroup`'s
 *    terms and for the same kind of reason: the card it renders carries OPTION
 *    BUTTONS that write back and wake an agent, so a caller-settable key would
 *    let anybody hang a working control off anybody's words.
 * 11. **Escalation answer.** `escalationAnswer` stripped unconditionally and
 *    re-stamped only after the named escalation is proved to be an answerable
 *    one IN THIS CHANNEL and the caller is proved to be one of the members it
 *    asked. ⚠ Its `agentId` — the wake key — is DERIVED from the escalation's
 *    own `client_msg_id` stamp and is never accepted from the caller. Both
 *    checks live in `service-writes-metadata-escalation.ts`, which is a §1 split
 *    rather than a fold here because it READS ANOTHER ROW and enforces an
 *    authorization.
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput,
  opts: PostMetadataOptions = {}
): Promise<PostMetadataResult> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  // ⚠ ONE roster read per post, AT MOST, and only if something asks. Two folds
  // want `channel_members` — thread inheritance (3) and mention resolution (9)
  // — and neither runs on the common post. Memoized on the PROMISE so two
  // concurrent asks share one round trip.
  let rosterPromise: Promise<ChannelMemberRow[]> | null = null;
  const roster = () => (rosterPromise ??= repo.listMembers(channel.id));
  delete metadata.to_user_id;
  // Stripped, never re-stamped: consumer is gone, but a name the docs call
  // server-owned must not stay forgeable.
  delete metadata.to_user_notify;
  delete metadata.summary;
  delete metadata.runtime;
  delete metadata.appVersion;
  // ⚠ Stripped, never re-stamped. Nothing writes these any more, but the strip
  // keeps a new post from FORGING the attribution an old row legitimately has.
  delete metadata.to_agent_id;
  delete metadata.to_agent_ids;
  delete metadata.author_agent_id;
  delete metadata.intent;
  // ⚠ Stripped UNCONDITIONALLY: a caller able to set this could attribute its
  // own post to somebody else's session — the forensic question the key answers.
  delete metadata.session_id;
  // ⚠ Desktop reads `handoff` to decide whether to OPEN A WINDOW, so a
  // caller-set value could open a session on the operator's machine without
  // going through validated `create_thread`. Re-stamped only from `opts` below.
  delete metadata.handoff;
  // ⚠ Same terms as `handoff`: the transcript groups every opening message
  // sharing this id into ONE request card, so a settable group id is a way to
  // render your own thread inside somebody else's request.
  delete metadata.fanoutGroup;
  // ⚠ Same terms as `fanoutGroup`, one step sharper: this key decides whose
  // Tags inbox the message lands in (and, from Phase 7, who gets notified), so
  // a caller able to set it could put its words in anybody's inbox without
  // naming them. Re-stamped from the server's own parse below.
  delete metadata[MENTIONS_METADATA_KEY];
  // ⚠ Same terms as `fanoutGroup`, and the sharpest of the family: the card this
  // key renders carries OPTION BUTTONS that write back and wake an agent. A
  // caller able to set it could hang a working control off anybody's words, and
  // the ANSWER key could aim a wake at an agent that never asked anything.
  delete metadata[ESCALATION_METADATA_KEY];
  delete metadata[ESCALATION_ANSWER_METADATA_KEY];
  const calmFlags = takeCalmFlags(metadata);

  // Only when supplied — absent stamps no key, and absence reads as `request`.
  if (input.intent) metadata.intent = input.intent;

  // ⚠ From the request HEADER, never the payload. `ctx.runtime` is already
  // NARROWED (unrecognized label, or `desktop-ui` from an agent token, arrives
  // undefined).
  if (ctx.runtime) metadata.runtime = ctx.runtime;
  if (ctx.appVersion) metadata.appVersion = ctx.appVersion;
  // Verbatim — shape already checked by `session-header.ts`.
  if (ctx.sessionId) metadata.session_id = ctx.sessionId;

  // ⚠ THE VALIDATED FIELD, WITH NO FALLBACK BEHIND IT. There is no shape of
  // channel in which the server picks an addressee the caller did not name.
  const toUserId = input.toUserId;
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
  // Dropping a blank/non-string tag here is what lets everything below read
  // `metadata.taskId` as "an ACCEPTED thread tag".
  if (!callerTaskId) delete metadata.taskId;

  let task: ChannelTaskRow | null = null;
  if (callerTaskId) {
    if (isUuid(callerTaskId)) {
      task = await repoTasks.findTaskByChannelAndId(channel.id, callerTaskId);
      if (!task) throw new ChannelTaskNotInChannelError(callerTaskId);
      // Membership in the channel is not membership in the THREAD.
      if (!isThreadParticipant(task, ctx.userId)) {
        throw new TaskForbiddenError("post into this task");
      }
    } else if (
      !(await isLegacyThreadParticipant(channel.id, callerTaskId, ctx.userId))
    ) {
      // ⚠ A legacy id that is not the poster's own exchange is STRIPPED, never
      // refused — the post lands untagged, silently. The installed desktop that
      // sends these ids has no diag lane to show a refusal on.
      delete metadata.taskId;
    }
  } else if (
    toUserId &&
    (input.kind ?? "message") === "message" &&
    // ⚠ Resolved LAZILY, and only for a post that could inherit: with the
    // auto-address fallback gone this roster read has one reader left, and a
    // group-channel or threaded post must not pay for it. `chat` never resolves
    // a peer AT ALL, which is what keeps a chat post out of an open thread.
    input.intent !== "chat"
  ) {
    const peerUserId = await resolveDirectPeer(channel, ctx.userId, roster);
    if (peerUserId && toUserId === peerUserId) {
      task = await resolveInheritableTask(channel, ctx.userId, peerUserId);
      if (task) metadata.taskId = task.id;
    }
  }

  if (task) {
    metadata.taskMode = task.mode;
    metadata.taskCreatedBy = task.created_by;
    metadata.taskTitle = task.title;
    // Null target (unaddressed task) stamps nothing — desktop's suppression
    // predicate then cannot match and falls through to the trigger rules.
    if (task.target_user_id) metadata.taskTarget = task.target_user_id;
  }

  // ⚠ Re-stamp only for the thread's own participants — which is the same
  // question as "did a thread tag survive the gate above". Anything else (a
  // foreign thread, unresolvable id, no thread) has no `taskId` left, so a
  // fabricated outcome has nothing to attach to.
  if (calmFlags.length > 0 && typeof metadata.taskId === "string") {
    for (const key of calmFlags) metadata[key] = true;
  }

  // Spawn-with-handoff, same discipline: only onto a thread tag the poster is
  // entitled to (the opening message always is). ⚠ ROUTING HINT, NOT an
  // authorization — desktop still requires the identity pair (author === me,
  // task creator === me), so a peer-attached `handoff` opens nothing on anyone
  // else's machine. Literal boolean, read `=== true` on the desktop.
  if (opts.handoff === true && typeof metadata.taskId === "string") {
    metadata.handoff = true;
  }

  // Fan-out group, same discipline and the same condition: it only ever rides
  // the opening message of a thread the poster just created, so a tag that did
  // not survive the participation gate above takes the group with it.
  if (opts.fanoutGroupId && typeof metadata.taskId === "string") {
    metadata.fanoutGroup = opts.fanoutGroupId;
  }

  // MENTIONS — the server's own parse, never the caller's claim. ⚠ Deliberately
  // NOT conditioned on a surviving thread tag, unlike `handoff` / `fanoutGroup`:
  // those two are claims ABOUT a thread, and this is a claim about the BODY,
  // which stands on its own in a plain channel post. Empty stamps no key.
  // ⚠ `ctx.source` decides whether the AUTHOR survives the resolution: an agent
  // tagging its own operator is that agent's escalation path, a human tagging
  // themselves is not an inbox item. The credential answers it, never the body —
  // see `service-writes-metadata-mentions.ts`.
  const mentioned = await resolveBodyMentions(
    input.body,
    ctx.userId,
    roster,
    ctx.source === "agent"
  );
  if (mentioned.length > 0) metadata[MENTIONS_METADATA_KEY] = mentioned;

  // ESCALATION (10) and its ANSWER (11). ⚠ The answer runs LAST because it is
  // the only fold that can THROW an authorization error, and a post refused
  // there must not have been able to change anything on the way past.
  resolveEscalation(input, metadata);
  if (input.escalationAnswer) {
    await resolveEscalationAnswer(
      channel.id,
      ctx.userId,
      input.escalationAnswer,
      metadata
    );
  }

  return { metadata };
}
