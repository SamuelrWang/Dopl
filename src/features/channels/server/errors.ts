export class ChannelError extends Error {
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

/**
 * A posted message was addressed (`toUserId`) to someone who is not a
 * member of the channel. Mapped to a 400 so the caller fixes the address.
 */
export class ChannelAddresseeNotMemberError extends ChannelError {
  constructor(public readonly userId: string) {
    super(`Addressed user is not a member of this channel: ${userId}`);
  }
}

/**
 * Removing this member would leave the channel with no owner. Blocks a last
 * owner leaving / being removed — transfer ownership first.
 */
export class ChannelLastOwnerError extends ChannelError {
  constructor() {
    super("Cannot remove the last owner of this channel");
  }
}

/**
 * A consent request the caller can't act on — either it doesn't exist or it
 * isn't addressed to the caller (operator). Collapsed to one not-found so a
 * caller can't probe another operator's request ids.
 */
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

/**
 * A task the caller can't act on — either it doesn't exist in this channel or
 * it isn't scoped to the caller's workspace. Collapsed to one not-found so an
 * id can't be probed.
 */
export class TaskNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Task not found: ${ref}`);
  }
}

/** Caller lacks the task-scoped permission (set-mode: creator; close: creator
 *  or target). */
export class TaskForbiddenError extends ChannelError {
  constructor(action: string) {
    super(`Not allowed to ${action}`);
  }
}

/**
 * A post carried a first-class (UUID) `taskId` that resolves to no task in
 * THIS channel — so it can't be threaded. Rejected (400) rather than silently
 * dropping the thread stamp, so a bogus first-class id can't fabricate a
 * threaded group. Legacy `task-<uuid>-<seq>` ids are not UUIDs and never enter
 * this branch.
 */
export class ChannelTaskNotInChannelError extends ChannelError {
  constructor(public readonly taskId: string) {
    super(`Task is not in this channel: ${taskId}`);
  }
}

/**
 * A thread would be addressed to the caller themselves. Refused (400) rather
 * than accepted silently: only the thread's creator and its target may post
 * into it, so a self-addressed thread has exactly ONE party — the member who
 * asked — and nobody's desktop ever routes it. It renders in the panel as a
 * live request "addressed to <caller>", the peer's listener logs `verdict
 * ignore`, and it can never be answered. Distinct from
 * {@link DirectSelfTargetError} (a self-DM): different resource, different
 * code. `post to=self` is deliberately NOT guarded — the desktop already
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
 * A post declared `intent:"chat"` AND addressed a PERSON (`toUserId`). 400.
 *
 * WHY IT IS REFUSED rather than reconciled. A human addressee is the one address
 * that starts ANOTHER PERSON'S agent on a subject they never saw a title for.
 * Chat means "raise no prompt on anyone's machine"; a `toUserId` means "raise
 * one on exactly this machine". Dropping the address would silently fail to
 * deliver a message the caller believes was routed, and dropping the intent
 * would poke a machine the caller explicitly said not to — so the pair is
 * refused and the CALLER chooses. Requesting a person's agent is what REQUEST
 * mode is for, and it carries the title their consent prompt renders.
 *
 * F-145 — THE MESSAGE AND THIS DOCBLOCK BOTH TAUGHT A DELETED PARAM. The
 * sentence sent to callers read "Mention an agent with toAgents to have it
 * act", and the docblock above it still recorded the 2026-07-31 narrowing
 * ("`toAgent` / `toAgents` under chat are ALLOWED and no longer reach here").
 * Both outlived the surface: rollback §1 deleted named-agent addressing, and
 * `schema.ts#removedParam` now declares `toAgent` / `toAgents` as `z.never()`,
 * so following this advice produces a 400 — the error told the caller to do the
 * one thing guaranteed to fail again. The MCP twin was corrected at the time
 * (`packages/mcp-server/src/tools/channel-post-notes.ts`'s
 * `CHAT_ADDRESSED_REFUSAL`) and this HTTP copy was not; the wording now says the
 * same thing that one does, because two statements of one rule is how the copy
 * in this feature drifted from the code three times already.
 */
export class ChannelChatAddressedError extends ChannelError {
  constructor(public readonly field: string) {
    super(
      `A chat message cannot be addressed to a person (${field}). Drop the address to send it as chat, or post with intent "request" to reach that teammate's machine — a request carries the title their consent prompt renders.`
    );
  }
}

/**
 * An AGENT-token caller tried to post a LIFECYCLE kind (`task_started` /
 * `task_finished` / `task_failed`). 403.
 *
 * THE INCIDENT (2026-08-04). A responder's agent did the work and posted its
 * whole answer as `kind:"task_finished"`, and the answer appeared nowhere on the
 * requester's side: `lib/group-thread.ts` folds a terminal marker into
 * `draft.endEvent` and never pushes it to `draft.entries`, so its body is
 * structurally unrenderable. The prompt invited the mistake (it framed the four
 * kinds as an interchangeable vocabulary) and the tool's default made it easy —
 * but the deeper problem is that the three lifecycle kinds are not statements an
 * agent is in a position to make. They say "a session started / finished /
 * failed", which is a fact about a RUNTIME, and the runtime that owns those
 * facts is the desktop's session engine (`dopl-desktop-app/main/session-window.js`)
 * or the close route's own echo (`service-tasks.closeTask`).
 *
 * SO THE LANE IS CLOSED BY IDENTITY, not by kind alone. `ctx.source === "agent"`
 * means the request arrived on a bearer AGENT TOKEN, which is every MCP
 * `op="post"` and nothing else: the desktop listener and the web both post on
 * the operator's cookies (`source === "user"`) and keep working byte for byte,
 * and the close echo is exempted explicitly by the one server-internal caller
 * that raises it (see `postMessage`'s `internal` option).
 *
 * `task_progress` is deliberately NOT here. It is the milestone lane and stays
 * agent-writable — it is the one `task_*` kind whose body IS rendered
 * (`splitSessionEntries`), and it claims nothing about a session's lifecycle.
 */
export class ChannelLifecycleKindForbiddenError extends ChannelError {
  constructor(public readonly kind: string) {
    super(
      `"${kind}" is a lifecycle marker posted by the runtime and by a thread close, not by an agent. ` +
        `Post your message with no kind (the default) — a body written into a lifecycle event is not rendered on the thread card at all. ` +
        `To mark a step that landed, post kind "task_progress".`
    );
  }
}

/**
 * An AGENT-token caller tried to CLOSE a thread. 403.
 *
 * DECISION (Samuel, 2026-08-04): thread close is PROPOSE-then-CONFIRM. Closing
 * settles the SHARED thread for BOTH members, and one machine's agent deciding
 * the work "looks done" is not the same as the human deciding they are finished
 * with the exchange — they may still have things to say in it. So an agent's
 * terminal act is a PROPOSAL (`op:"propose_close"`) that surfaces to its operator
 * as a confirmable prompt, and the close itself stays on the human lane.
 *
 * THE LINE IS THE CREDENTIAL, because it is the only one the wire can draw: an
 * agent token is a machine acting on its own turn, a cookie session is a person
 * in the app. Consequence to know: closing from an external CLI over MCP is no
 * longer possible — the human closes in the app (web thread card, the desktop
 * session window, or the SPA).
 */
export class ThreadCloseIsHumanOnlyError extends ChannelError {
  constructor() {
    super(
      "An agent cannot close a thread — closing settles it for both members and is the human's decision. " +
        'Propose it instead (op:"propose_close"), and your operator confirms.'
    );
  }
}

/** A direct channel would target the caller themselves — a self-DM is refused. */
export class DirectSelfTargetError extends ChannelError {
  constructor() {
    super("Cannot open a direct channel with yourself");
  }
}

/**
 * A direct (1:1) channel's shape is immutable: its two-member roster and its
 * (always private) visibility can't change. Blocks a third member being added
 * and a visibility toggle, so neither surfaces the raw CHECK-constraint 500.
 * `aspect` names what was attempted (e.g. "membership", "visibility"). 400.
 */
export class DirectChannelImmutableError extends ChannelError {
  constructor(aspect: string) {
    super(`Direct message ${aspect} can't be changed`);
  }
}
