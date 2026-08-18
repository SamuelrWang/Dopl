import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelRow, ChannelTaskRow } from "./dto";
import { ChannelTaskNotInChannelError, TaskForbiddenError } from "./errors";
import * as repo from "./repository";
import * as repoTasks from "./repository-tasks";
import {
  isLegacyThreadParticipant,
  isThreadClosed,
  isThreadParticipant,
} from "./service-writes-metadata-thread";
import {
  CLOSE_PROPOSAL_KEYS,
  REOPEN_MARKER_KEY,
  takeCalmFlags,
} from "./service-writes-metadata-markers";
import type { ChannelContext } from "./service-shared";

/**
 * ONE place that decides what lands in `channel_messages.metadata`.
 *
 * RESERVED KEYS — always stripped from caller metadata, re-added only from
 * server-validated values: `to_user_id`, `summary`, `runtime`, `appVersion`,
 * `session_id`, `to_user_notify`, `taskMode`, `taskCreatedBy`, `taskTitle`,
 * `taskTarget`, `to_agent_id`, `to_agent_ids`, `author_agent_id`, `intent`,
 * `handoff`, the six calm-terminal flags, the two close-proposal keys, and
 * `threadReopened`. `taskId` stays caller-settable, but every thread id —
 * first-class or legacy — must BELONG to the poster (see
 * {@link resolvePostMetadata}). Marker keys live in
 * `service-writes-metadata-markers.ts`, the thread half in
 * `service-writes-metadata-thread.ts`.
 *
 * ⚠ The three agent keys have no writer left but MUST stay in the strip list:
 * `author_agent_id` is what the transcript reads to attribute an old message to
 * a handle, so a caller who could set it could attribute its own words to
 * somebody's retired agent. Stored rows keep theirs and keep rendering.
 */

/**
 * Other member of a DIRECT channel, or undefined when ambiguous. A DM is exactly
 * two members; any other shape resolves to nothing rather than guessing.
 * Read off the same roster table the explicit `to` path validates against, so an
 * auto-addressed peer satisfies addressee-is-active-member by construction.
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
 * Single OPEN task of a direct channel whose participants are exactly
 * {author, peer}, else null. All-or-nothing: with 2+ candidates a guess would
 * attach a turn to the wrong card and route it to the wrong session window on
 * the peer's machine.
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
      task.status === "open" &&
      ((task.created_by === authorUserId &&
        task.target_user_id === peerUserId) ||
        (task.created_by === peerUserId &&
          task.target_user_id === authorUserId))
  );
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Stored `metadata` plus the one notice nothing downstream could re-derive
 * without a second query. The thread row is resolved here and NOWHERE else on
 * the write path, so this is the only place that can see a post landing in a
 * CLOSED thread. ⚠ Rides out as a notice, never stamped into `metadata` — the
 * message is not different for being late, only the caller's report is.
 */
export interface PostMetadataResult {
  metadata: Record<string, unknown>;
  /** True when the post landed in a thread whose row is no longer open. */
  threadClosed: boolean;
}

/**
 * Server-internal inputs to the metadata fold — no HTTP caller can supply
 * these; they are not fields of `ChannelMessageCreateInput` and no route parses
 * them.
 */
export interface PostMetadataOptions {
  /**
   * Stamp as CLOSE PROPOSAL with that outcome. Only caller:
   * `service-tasks-propose.proposeTaskClose`, which has already checked poster
   * is the thread's creator or target.
   */
  closeProposal?: "completed" | "failed";
  /**
   * Stamp as the REOPEN ECHO. Only caller:
   * `service-tasks-lifecycle.reopenTask`, which has already checked poster is
   * creator or target and that the row really moved `closed` -> `open`. See
   * {@link REOPEN_MARKER_KEY}.
   */
  reopened?: boolean;
  /**
   * Stamp reserved `metadata.handoff` true. Only caller:
   * `service-tasks.createTask`, forwarding validated `TaskCreateInput.handoff`.
   * ⚠ Reserved on the runtime stamp's terms — desktop reads it to decide whether
   * to open a requester window, so it must never be caller-settable.
   */
  handoff?: boolean;
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
 * 2. **DM auto-address.** Direct channel + no caller `to` → peer stamped as
 *    `to_user_id`; an unaddressed agent message is deliberately ignorable on the
 *    receiving desktop (loop brake), so a real DM reply would otherwise post and
 *    never deliver. ⚠ NEVER in a non-direct channel — with 3+ members a wrong
 *    guess prompts the wrong operator. Skipped entirely under `intent:"chat"`.
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
 * 7b. **Reopen marker.** `threadReopened` on the same condition — the echo
 *    carrying this key IS the doorbell, since `channel_tasks` is in no realtime
 *    table set.
 * 8. **Closed-thread notice.** Resolved row's `status`. Changes NOTHING about
 *    the message; rides out on {@link PostMetadataResult}. See
 *    {@link isThreadClosed} for why this warns rather than refuses.
 */
export async function resolvePostMetadata(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput,
  opts: PostMetadataOptions = {}
): Promise<PostMetadataResult> {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) };
  // ⚠ Stripped BEFORE anything decides whether a stamp is coming, like
  // `session_id` below. {@link CLOSE_PROPOSAL_KEYS}, {@link REOPEN_MARKER_KEY}.
  for (const key of CLOSE_PROPOSAL_KEYS) delete metadata[key];
  delete metadata[REOPEN_MARKER_KEY];
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

  // ⚠ CHAT never RESOLVES a peer, rather than resolving and discarding — the
  // fallback below reads whatever `peerUserId` holds, so leaving nothing to fall
  // back to is the only way a chat post can never be auto-addressed.
  const peerUserId =
    input.intent === "chat"
      ? undefined
      : await resolveDirectPeer(channel, ctx.userId);
  const toUserId = input.toUserId ?? peerUserId;
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

  // Close proposal — same condition as the calm flags. Belt and braces
  // (`proposeTaskClose` already checked creator-or-target); the belt is what
  // makes "a prompt to close this thread" unforgeable, not merely unforged.
  if (opts.closeProposal && typeof metadata.taskId === "string") {
    metadata.closeProposed = true;
    metadata.closeOutcome = opts.closeProposal;
  }

  // Reopen echo marker, on the close proposal's exact condition. `reopenTask`
  // already established creator-or-target and that the row really moved to
  // `open`. ⚠ Literal boolean, read `=== true` by the client, so a
  // truthy-but-not-true value never counts.
  if (opts.reopened === true && typeof metadata.taskId === "string") {
    metadata[REOPEN_MARKER_KEY] = true;
  }

  // Spawn-with-handoff, same discipline: only onto a thread tag the poster is
  // entitled to (the opening message always is). ⚠ ROUTING HINT, NOT an
  // authorization — desktop still requires the identity pair (author === me,
  // task creator === me), so a peer-attached `handoff` opens nothing on anyone
  // else's machine. Literal boolean, read `=== true` on the desktop.
  if (opts.handoff === true && typeof metadata.taskId === "string") {
    metadata.handoff = true;
  }

  // Read off the row the folds already resolved. An INHERITED task can never be
  // closed (`resolveInheritableTask` filters to `open`), so this fires only for
  // a caller-supplied first-class id.
  return { metadata, threadClosed: isThreadClosed(task) };
}
