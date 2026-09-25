import { ChannelError } from "./errors-base";

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

// Re-exported: `errors.ts` is the one import path for every channel error.
export {
  ChannelAgentHandleAmbiguousError,
  ChannelRecipientUnresolvedError,
} from "./errors-recipient";

/** Would leave the channel with no owner — transfer ownership first. */
export class ChannelLastOwnerError extends ChannelError {
  constructor() {
    super("Cannot remove the last owner of this channel");
  }
}

/** Consent request the caller can't act on. Nonexistent and foreign-operator collapse to one
 *  not-found so request ids can't be probed. */
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

/** Task the caller can't act on. Wrong-channel and wrong-workspace collapse to one not-found so
 *  ids can't be probed. */
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

/** A UUID `taskId` naming no task in this channel. 400 rather than dropping the stamp, so a bogus id
 *  can't fabricate a thread; legacy `task-<uuid>-<seq>` ids are not UUIDs and never reach it. */
export class ChannelTaskNotInChannelError extends ChannelError {
  constructor(public readonly taskId: string) {
    super(`Task is not in this channel: ${taskId}`);
  }
}

/** A thread addressed to its own creator: 400, since it has one party and nobody's desktop would
 *  route it. `post to=self` is not guarded — a post is not a thread. */
export class TaskSelfTargetError extends ChannelError {
  constructor() {
    super(
      "Cannot open a thread addressed to yourself — a thread must be addressed to another member"
    );
  }
}

/** `intent:"chat"` with a human `toUserId`: 400, refused rather than reconciled — the caller chooses.
 *  The message must never recommend a param `schema-removed-params.ts › removedParam` declares
 *  `z.never()`. */
export class ChannelChatAddressedError extends ChannelError {
  constructor(public readonly field: string) {
    super(
      `A chat message cannot be addressed to a person (${field}). Drop the address to send it as chat, or post with intent "request" to reach that teammate's machine — a request carries the title their consent prompt renders.`
    );
  }
}

/** An agent token (`ctx.source === "agent"`) posted a lifecycle kind: 403. Those kinds state a
 *  runtime fact and their body never renders (`view-model-rows.ts › isLifecycleKind`); the
 *  credential is the whole test, with no exemption. `task_progress` is allowed: it is the milestone lane. */
export class ChannelLifecycleKindForbiddenError extends ChannelError {
  constructor(public readonly kind: string) {
    super(
      `"${kind}" is a lifecycle marker posted by the runtime, not by an agent. ` +
        `Post your message with no kind (the default) — a body written into a lifecycle event is not rendered on the thread card at all. ` +
        `To mark a step that landed, post kind "task_progress".`
    );
  }
}

/** A direct channel would target the caller themselves — a self-DM is refused. */
export class DirectSelfTargetError extends ChannelError {
  constructor() {
    super("Cannot open a direct channel with yourself");
  }
}

/** The Home space holds no channels: each home channel is its own `kind='link'` container. */
export class ChannelInHomeSpaceError extends ChannelError {
  constructor() {
    super(
      "Channels cannot live in your Home space. Create a home channel instead (POST /api/channels?scope=account; over MCP, create a channel with no container)."
    );
  }
}

/** A direct channel is immutable (two members, always private). Refused as 400 instead of the
 *  CHECK-constraint 500. `aspect` names what was attempted. */
export class DirectChannelImmutableError extends ChannelError {
  constructor(aspect: string) {
    super(`Direct message ${aspect} can't be changed`);
  }
}

/** The info card exceeds the byte ceiling: the friendly 4xx in front of `channels_info_card_check`,
 *  which PostgREST would surface as a 500 (`info-card.ts › infoCardWithinByteLimit`). */
export class ChannelInfoCardTooLargeError extends ChannelError {
  constructor(bytes: number, limit: number) {
    super(`Info card is too large (${bytes} bytes; limit ${limit})`);
  }
}

/** Not an answerable escalation in this channel. One error for four causes (missing, other channel,
 *  no escalation payload, option index out of range) so message ids can't be probed. */
export class EscalationNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`No answerable escalation here: ${ref}`);
  }
}

/** The caller is not one this escalation asked. 403 rather than a silent strip: a strip would report
 *  success over an answer nobody received. Reached only after the 404 checks, so it discloses nothing. */
export class EscalationForbiddenError extends ChannelError {
  constructor() {
    super(
      "This escalation was not addressed to you. Only the member it tagged — or, when it tagged nobody, the operator whose agent asked — can answer it."
    );
  }
}

/** A second answer. Raised from the partial unique index's 23505, never a read-then-write check. */
export class EscalationAlreadyAnsweredError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`This escalation has already been answered: ${ref}`);
  }
}

/** A direction id this operator doesn't own. Missing, other operator and other workspace are one
 *  error: a direction row carries a private turn's `reply`, so ids must not be probeable. */
export class DirectionNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Direction not found: ${ref}`);
  }
}

/** Taken by another of this operator's machines, decided, or expired; the desktop reads the 409 as
 *  stand down. */
export class DirectionNotClaimableError extends ChannelError {
  constructor(public readonly reason: "taken" | "decided" | "expired") {
    super(`Direction is not claimable (${reason})`);
  }
}

/** The target agent belongs to another member. The one 403 on this lane: the caller has proved
 *  membership, where roster and live agents are readable anyway, and a 404 would send an orchestrator
 *  to re-launch its own agent. Not the fence (`operator_user_id` is). */
export class AgentDirectiveForeignError extends ChannelError {
  constructor(public readonly agentId: string) {
    super(`Agent ${agentId} belongs to another member`);
  }
}

/** Missing, another operator's, or another workspace's: one error so directive ids can't be probed. */
export class LaunchDirectiveNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Launch directive not found: ${ref}`);
  }
}

/** Taken by a sibling machine, decided, or expired. A 409 the desktop treats as stand down: losing
 *  the claim race is the designed outcome for every machine but one. */
export class LaunchDirectiveNotClaimableError extends ChannelError {
  constructor(public readonly reason: "taken" | "decided" | "expired") {
    super(`Launch directive is not claimable: ${reason}`);
  }
}

/** An identity ref that does not resolve for the caller; missing and invisible stay one answer. It
 *  answers on `AgentIdentityNotFoundError`'s code (`http-mapping.ts`). `elsewhere` only names an
 *  identity the caller could already list, in another tenancy
 *  (`service-resolve-ref.ts › classifyMissingIdentityRef`). */
export class LaunchIdentityNotFoundError extends ChannelError {
  constructor(
    public readonly ref: string,
    public readonly elsewhere: { name: string; label: string } | null = null
  ) {
    super(`Agent identity not found: ${ref}`);
  }
}

/** A launch named a colour a live agent in this channel holds. Refused, never substituted: the caller
 *  named it. `free` is not an oracle (the caller is a member and sees every colour) and not a
 *  reservation (`channel_sessions_channel_color_live_key` is the authority). */
export class AgentColorTakenError extends ChannelError {
  constructor(
    public readonly color: string,
    public readonly free: readonly string[]
  ) {
    super(
      `Agent colour ${color} is already in use by a live agent in this channel`
    );
  }
}

/** A name matching more than one visible identity: refused, never picked (names are not unique).
 *  Every listed match already passed `canSeeIdentity` for the caller. */
export class LaunchIdentityAmbiguousError extends ChannelError {
  constructor(
    public readonly ref: string,
    public readonly matches: ReadonlyArray<{
      id: string;
      name: string;
      visibility: string;
    }>
  ) {
    super(
      `Agent identity name is ambiguous: ${ref} matches ${matches.length} identities you can see`
    );
  }
}
