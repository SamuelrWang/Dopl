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

// ⚠ `TrustSelfError` and `TrustedNotMemberError` STOOD HERE AND ARE DELETED
// (2026-08-22). Both were raised only by `trust-service.ts › createTrustRule`,
// which is deleted with the `agent_trust_rules` table and the two `/trust`
// routes. Their `TRUST_SELF` / `TRUST_NOT_MEMBER` codes left
// `http-mapping.ts` in the same change — an error class with no thrower still
// publishes an API code, and a published code is a contract somebody writes a
// client against.

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

/**
 * The info card's serialized form exceeds the app byte ceiling.
 *
 * ⚠ THIS IS THE FRIENDLY 4xx IN FRONT OF THE DB CHECK. `channels_info_card_check`
 * bounds `octet_length(info_card::text)` and a PostgREST constraint failure is
 * not an `Error` this layer can classify — it falls through to a generic 500.
 * The per-field zod caps cannot bound the TOTAL (a full CJK card is ~9.6 KB), so
 * the write path measures the same jsonb text form and raises this first
 * (`info-card.ts › infoCardWithinByteLimit`).
 */
export class ChannelInfoCardTooLargeError extends ChannelError {
  constructor(bytes: number, limit: number) {
    super(`Info card is too large (${bytes} bytes; limit ${limit})`);
  }
}

/**
 * An `escalationAnswer` naming a message that is not an answerable escalation in
 * this channel.
 *
 * ⚠ ONE ERROR FOR FOUR SITUATIONS, DELIBERATELY: no such message, a message in
 * another channel, a message carrying no escalation payload, and an option index
 * outside that escalation's own list. `ChannelNotFoundError`'s rule and the same
 * reason — the alternative is a probe that walks the deployment's message ids and
 * learns which of them are escalations and how many options each has.
 */
export class EscalationNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`No answerable escalation here: ${ref}`);
  }
}

/**
 * The caller is not one of the people this escalation asked.
 *
 * ⚠ **403, WHERE A FOREIGN THREAD TAG IS SILENTLY STRIPPED (INVARIANTS §5), AND
 * THE ASYMMETRY IS THE RULING.** The strip exists because installed desktops post
 * legacy `task-…` ids and a refusal would reject real posts from the field.
 * `escalationAnswer` has no installed writers; a silent strip here would let a
 * button report success over an answer that reached nobody, which is the failure
 * the escalation card exists to remove.
 *
 * ⚠ It is reached only AFTER the row has been proved to be an answerable
 * escalation in this channel, so it discloses nothing a 404 was protecting.
 */
export class EscalationForbiddenError extends ChannelError {
  constructor() {
    super(
      "This escalation was not addressed to you. Only the member it tagged — or, when it tagged nobody, the operator whose agent asked — can answer it."
    );
  }
}

/**
 * A second answer to an escalation that already has one.
 *
 * ⚠ Raised from the 23505 of the partial unique index over
 * `metadata->'escalationAnswer'->>'escalationMessageId'`, never from a
 * read-then-write check: that would be a race with a friendlier message and no
 * guarantee behind it.
 */
export class EscalationAlreadyAnsweredError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`This escalation has already been answered: ${ref}`);
  }
}

/**
 * A DIRECTION id that resolves to nothing THIS operator owns.
 *
 * ⚠ ONE ERROR FOR THREE SITUATIONS, DELIBERATELY, and here the stakes are higher
 * than the launch mailbox's: it does not exist, it belongs to another operator, or
 * it is in another workspace. Splitting them would make this an id-probe primitive
 * for every direction in the deployment — **and a direction row carries a private
 * turn's answer in `reply`.** `ChannelNotFoundError`'s rule, same reason.
 */
export class DirectionNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Direction not found: ${ref}`);
  }
}

/**
 * A direction that cannot be claimed: already taken by another of this operator's
 * machines, already decided, or past its TTL.
 *
 * ⚠ THE DESKTOP LANE READS THE 409 AS "STAND DOWN", NOT AS A FAULT — losing the
 * claim CAS is the designed outcome for every machine but one.
 */
export class DirectionNotClaimableError extends ChannelError {
  constructor(public readonly reason: "taken" | "decided" | "expired") {
    super(`Direction is not claimable (${reason})`);
  }
}

/**
 * A ping's `to=` that names nobody on this channel's ACTIVE roster.
 *
 * ⚠ 400, NOT 404 — the same call the addressee check on a post answers
 * (`ChannelAddresseeNotMemberError`), and for the same reason: the caller has
 * already proved it can reach the CHANNEL, so the refusal discloses nothing about
 * a room it could not see, and the fix is in the caller's own hand.
 *
 * ⚠ ONE ERROR FOR "not a channel member", "not an active workspace member" and
 * "not a member reference at all". Splitting them would turn a ping into a probe
 * for which ids exist in the deployment, and none of the three changes what the
 * caller must do.
 */
export class PingRecipientNotMemberError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Ping recipient is not a member of this channel: ${ref}`);
  }
}

/**
 * A ping addressed with `to=` to the sender themselves.
 *
 * ⚠ REFUSED RATHER THAN DELIVERED, and the message names the instrument that
 * does work: a ping to yourself is almost always an agent trying to reach ITS
 * OWN operator's external session, and `toDesktop` is the spelling for that —
 * it stamps the same `recipient_user_id` and reaches the session that holds
 * `/api/pings/await` open, where a `to=` self-ping would land in a card the
 * operator is already looking at.
 */
export class PingSelfTargetError extends ChannelError {
  constructor() {
    super(
      "Cannot ping yourself with `to` — send it with `toDesktop: true` to reach your own operator's external Desktop Agent, or `agentId` to reach one of your own running agents."
    );
  }
}

/**
 * A launch directive id that resolves to nothing THIS operator owns.
 *
 * ⚠ ONE ERROR FOR THREE SITUATIONS, DELIBERATELY: it does not exist, it belongs
 * to another operator, or it is in another workspace. Splitting them would make
 * this a probe primitive for every directive in the deployment — the same rule
 * `ChannelNotFoundError` follows for a private channel, and the same reason.
 */
/**
 * **THE TARGET AGENT BELONGS TO ANOTHER MEMBER** — the agent-management kinds'
 * cross-member refusal (2026-09-01, `end` / `rename` over MCP).
 *
 * ⚠ **403-SHAPED, AND IT IS THE ONE PLACE ON THIS LANE THAT IS.** Everywhere
 * else here a foreign id answers 404 so existence cannot be probed
 * ({@link LaunchDirectiveNotFoundError}), and that rule is not being relaxed —
 * it does not APPLY. To reach this error the caller has already proved
 * membership of the channel, and inside a channel `dopl_channel(op="members")`
 * and `op="read_sessions"` disclose the roster and the live agents anyway. So
 * "that instance is another member's" reveals nothing new, while a 404 here
 * would tell an orchestrator its OWN agent had vanished and send it to re-launch.
 *
 * ⚠ **IT IS NOT THE FENCE.** `operator_user_id` is: a directive is stamped with
 * the authenticated caller and only that caller's machines ever claim one. This
 * turns a two-minute round trip ending in `no-session` into an immediate,
 * actionable sentence. `server/repository-agent-owner.ts` states exactly what the
 * underlying read can and cannot prove.
 */
export class AgentDirectiveForeignError extends ChannelError {
  constructor(public readonly agentId: string) {
    super(`Agent ${agentId} belongs to another member`);
  }
}

export class LaunchDirectiveNotFoundError extends ChannelError {
  constructor(public readonly ref: string) {
    super(`Launch directive not found: ${ref}`);
  }
}

/**
 * A directive that is no longer claimable or decidable — already taken by
 * another of this operator's machines, already decided, or past its TTL.
 *
 * ⚠ NOT AN ERROR ON THE DESKTOP'S SIDE OF THE CONVERSATION: losing a claim race
 * is the DESIGNED outcome for every machine but one, and the route answers 409
 * so the loser can stand down without logging a fault. It is an error only in
 * the sense that nothing was written.
 */
export class LaunchDirectiveNotClaimableError extends ChannelError {
  constructor(public readonly reason: "taken" | "decided" | "expired") {
    super(`Launch directive is not claimable: ${reason}`);
  }
}

/**
 * A directive named a TEMPLATE that does not resolve for the CALLER
 * (2026-08-23).
 *
 * ⚠ ONE ERROR FOR "no such template" AND "not visible to you", exactly as
 * `agent-templates/server/errors.ts › AgentTemplateNotFoundError` is, and it
 * carries that error's CODE rather than a channels-flavoured one: the two are
 * the same fact reached through two doors, and an agent that learned to read
 * `AGENT_TEMPLATE_NOT_FOUND` from `/resolve` must not have to learn a second
 * spelling here. Splitting them would make this a probe primitive for other
 * people's private templates — the oracle the 404-never-403 rule closes.
 *
 * ⚠ THROWN IN THE CHANNELS FEATURE RATHER THAN RE-THROWN FROM THE TEMPLATE ONE.
 * `agent-templates/server › resolveTemplateRef` answers with a union and throws
 * nothing, so this feature's error mapper does not have to import another
 * feature's error classes to know what a 404 means.
 *
 * ⚠ `elsewhere` IS THE ONE THING IT MAY ADD, AND IT IS NOT A CRACK IN THE RULE
 * ABOVE (T35). It is present only when the ref names a template the caller
 * COULD ALREADY LIST FOR THEMSELVES — their own row, or a `workspace`-visible
 * one, in a workspace they are an active member of — sitting in a DIFFERENT
 * tenancy than the channel's (`agent-templates/server/service-resolve-ref.ts ›
 * classifyMissingTemplateRef` holds the whole argument). It therefore says
 * nothing a list call would not, and `null` covers BOTH "no such template" and
 * "somebody else's, and not yours to see" — the two that must stay one answer.
 */
export class LaunchTemplateNotFoundError extends ChannelError {
  constructor(
    public readonly ref: string,
    public readonly elsewhere: { name: string; label: string } | null = null
  ) {
    super(`Agent template not found: ${ref}`);
  }
}

/**
 * A directive named a template by NAME and more than one visible template
 * carries it (2026-08-23).
 *
 * ⚠ **A REFUSAL, AND NEVER A PICK.** `agent_templates` has no name uniqueness by
 * design, so two people may each keep a "Researcher" and one of them may be
 * shared with the caller. Any collision rule — mine wins, newest wins,
 * most-recently-used wins — launches an identity the caller did not choose and
 * says nothing about it.
 *
 * ⚠ THE MATCH LIST RIDES ON THE ERROR AND IS NOT AN ORACLE: every row in it
 * already passed `canSeeTemplate` for this caller, so it discloses exactly what
 * `GET /api/agent-templates` would. It carries `visibility` because that is what
 * makes the disambiguation actionable — "the private one is mine".
 */
export class LaunchTemplateAmbiguousError extends ChannelError {
  constructor(
    public readonly ref: string,
    public readonly matches: ReadonlyArray<{
      id: string;
      name: string;
      visibility: string;
    }>
  ) {
    super(
      `Agent template name is ambiguous: ${ref} matches ${matches.length} templates you can see`
    );
  }
}
