class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ChannelNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Channel not found: ${ref}`);
  }
}

/** Caller lacks the channel-scoped permission for the attempted action. */
export class ChannelForbiddenError extends ChannelError {
  constructor(action: string) {
    super(`Not allowed to ${action}`);
  }
}

/** A channel with the same (workspace, slug) already exists. */
export class ChannelSlugConflictError extends ChannelError {
  constructor(slug: string) {
    super(`A channel with the slug "${slug}" already exists`);
  }
}

/** The invitee is not an active member of the workspace. */
export class ChannelInviteeNotMemberError extends ChannelError {
  constructor(userId: string) {
    super(`User is not an active workspace member: ${userId}`);
  }
}

/** The target is already a member of the channel. */
export class ChannelMemberExistsError extends ChannelError {
  constructor() {
    super("User is already a member of this channel");
  }
}

/** Addressed (`toUserId`) to a non-member. 400 so the caller fixes it. */
export class ChannelAddresseeNotMemberError extends ChannelError {
  constructor(public readonly userId: string) {
    super(`Addressed user is not a member of this channel: ${userId}`);
  }
}

/** Would leave the channel with no owner — transfer ownership first. */
export class ChannelLastOwnerError extends ChannelError {
  constructor() {
    super("Cannot remove the last owner of this channel");
  }
}

/** Consent request the caller can't act on. ⚠ Nonexistent and foreign-operator
 *  collapse to ONE not-found so request ids can't be probed. */
export class ConsentNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Consent request not found: ${ref}`);
  }
}

/** The consent request has already been decided (or expired) — no re-decide. */
export class ConsentAlreadyDecidedError extends ChannelError {
  constructor(public readonly status: string) {
    super(`Consent request already ${status}`);
  }
}

/** A trust rule would name the operator themselves — meaningless, refused. */
export class TrustSelfError extends ChannelError {
  constructor() {
    super("You cannot add a trust rule for yourself");
  }
}

/** The trusted target is not an active member of the workspace. */
export class TrustedNotMemberError extends ChannelError {
  constructor(public readonly userId: string) {
    super(`User is not an active workspace member: ${userId}`);
  }
}

/** Task the caller can't act on. ⚠ Wrong-channel and wrong-workspace collapse
 *  to ONE not-found so ids can't be probed. */
export class TaskNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Task not found: ${ref}`);
  }
}

/** Lacks the task-scoped permission — set-mode: creator; close: creator or
 *  target. */
export class TaskForbiddenError extends ChannelError {
  constructor(action: string) {
    super(`Not allowed to ${action}`);
  }
}

/**
 * A first-class (UUID) `taskId` resolving to no task in THIS channel. ⚠ Rejected
 * 400 rather than silently dropping the stamp, so a bogus id can't fabricate a
 * threaded group. Legacy `task-<uuid>-<seq>` ids are not UUIDs and never reach
 * this branch.
 */
export class ChannelTaskNotInChannelError extends ChannelError {
  constructor(public readonly taskId: string) {
    super(`Task is not in this channel: ${taskId}`);
  }
}

/**
 * A thread addressed to its own creator. ⚠ Refused 400, never accepted silently:
 * only creator and target may post, so it has ONE party and nobody's desktop
 * routes it — it renders as a live request that can never be answered.
 * Distinct from {@link DirectSelfTargetError} (self-DM): different resource,
 * different code. ⚠ `post to=self` is deliberately NOT guarded — the desktop
 * classifies a self-addressed post as noise, and a post is not a thread.
 */
export class TaskSelfTargetError extends ChannelError {
  constructor() {
    super(
      "Cannot open a thread addressed to yourself — a thread must be addressed to another member"
    );
  }
}

/**
 * `intent:"chat"` AND a human `toUserId`. 400.
 *
 * ⚠ Refused, never reconciled. Chat means "raise no prompt on anyone's machine";
 * a `toUserId` means "raise one on exactly this machine". Dropping the address
 * silently fails to deliver a message the caller believes was routed; dropping
 * the intent pokes a machine the caller said not to. The CALLER chooses.
 *
 * ⚠ Keep the message in sync with the MCP twin,
 * `packages/mcp-server/src/tools/channel-post-notes.ts`
 * `CHAT_ADDRESSED_REFUSAL`, and never let it recommend a param that
 * `schema.ts#removedParam` declares `z.never()` — that advises the caller to do
 * the one thing guaranteed to 400 again.
 */
export class ChannelChatAddressedError extends ChannelError {
  constructor(public readonly field: string) {
    super(
      `A chat message cannot be addressed to a person (${field}). Drop the address to send it as chat, or post with intent "request" to reach that teammate's machine — a request carries the title their consent prompt renders.`
    );
  }
}

/**
 * An AGENT-token caller tried to post a LIFECYCLE kind. 403.
 *
 * ⚠ The three lifecycle kinds state a fact about a RUNTIME, which an agent is
 * not in a position to make. The runtime that owned those facts was the desktop
 * session engine — and since wiring plan Phase 5 (2026-08-18) it no longer posts
 * them either (`main/session-window.js`), though the server deliberately still
 * ACCEPTS them because installed builds do (INVARIANTS §13). Either way an
 * answer posted as `task_finished` renders NOWHERE: the reader drops the three
 * kinds on sight (`components/channels-v2/view-model.ts › isLifecycleEcho`),
 * body and all. The old reason — a session card folding the marker into its
 * `endEvent` — went with the card.
 *
 * ⚠ The lane is closed by IDENTITY, not kind alone. `ctx.source === "agent"`
 * means a bearer AGENT TOKEN — every MCP `op="post"` and nothing else. Desktop
 * listener and web post on the operator's cookies (`source === "user"`) and are
 * unaffected, and they need no exemption to be. ⚠ THERE IS NO EXEMPTION LEFT AT
 * ALL: `internalLifecycle` — the declared "this post is the server speaking"
 * seam — was deleted on 2026-08-20 with no caller and none in prospect, and the
 * close echo it was written for went with thread closing in Phase 4
 * (2026-08-18). The CREDENTIAL is now the whole question. A future
 * server-internal lifecycle post earns its pass the way the reopen echo did —
 * post a kind the guard already permits — rather than ask for one. See
 * `service-writes-lifecycle.ts › PostMessageOptions`.
 *
 * ⚠ `task_progress` is deliberately NOT here — it is the milestone lane, the one
 * `task_*` kind whose body IS rendered, and claims nothing about lifecycle.
 */
export class ChannelLifecycleKindForbiddenError extends ChannelError {
  constructor(public readonly kind: string) {
    super(
      `"${kind}" is a lifecycle marker posted by the runtime, not by an agent. ` +
        `Post your message with no kind (the default) — a body written into a lifecycle event is not rendered on the thread card at all. ` +
        `To mark a step that landed, post kind "task_progress".`
    );
  }
}

/**
 * ⚠ `ThreadCloseIsHumanOnlyError` (403 `CHANNEL_CLOSE_IS_HUMAN_ONLY`) USED TO
 * LIVE HERE and was deleted with thread closing (wiring plan Phase 4,
 * 2026-08-18). It guarded a human-only lane over a shared thread's settlement;
 * there is no settlement left to guard — the operator pauses or ends an AGENT,
 * and nothing anywhere moves `channel_tasks.status`. Do not reintroduce the
 * code; the MCP classifier arm that read it is gone too.
 */

/** A direct channel would target the caller themselves — a self-DM is refused. */
export class DirectSelfTargetError extends ChannelError {
  constructor() {
    super("Cannot open a direct channel with yourself");
  }
}

/**
 * ⚠ A direct channel's shape is IMMUTABLE — two-member roster, always private.
 * Blocks a third member and a visibility toggle so neither surfaces the raw
 * CHECK-constraint 500. `aspect` names what was attempted. 400.
 */
export class DirectChannelImmutableError extends ChannelError {
  constructor(aspect: string) {
    super(`Direct message ${aspect} can't be changed`);
  }
}
