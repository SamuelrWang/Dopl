import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentHandleAmbiguousError,
  ChannelChatAddressedError,
  ChannelRecipientUnresolvedError,
  ChannelForbiddenError,
  ChannelInfoCardTooLargeError,
  ChannelInviteeNotMemberError,
  ChannelLastOwnerError,
  ChannelLifecycleKindForbiddenError,
  ChannelMemberExistsError,
  ChannelNotFoundError,
  ChannelSlugConflictError,
  ChannelTaskNotInChannelError,
  ConsentAlreadyDecidedError,
  AgentDirectiveForeignError,
  ConsentNotFoundError,
  DirectChannelImmutableError,
  DirectionNotClaimableError,
  DirectionNotFoundError,
  DirectSelfTargetError,
  EscalationAlreadyAnsweredError,
  EscalationForbiddenError,
  EscalationNotFoundError,
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
  AgentColorTakenError,
  LaunchIdentityAmbiguousError,
  LaunchIdentityNotFoundError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
} from "./errors";

/** Maps channel domain errors to `HttpError`; `null` for anything else, so the shared tail
 *  (`toHttpErrorResponse`) falls through to the generic 500. */
function mapChannelError(err: unknown): HttpError | null {
  if (err instanceof ChannelNotFoundError) {
    return new HttpError(404, "CHANNEL_NOT_FOUND", err.message);
  }
  if (err instanceof ChannelForbiddenError) {
    return new HttpError(403, "CHANNEL_FORBIDDEN", err.message);
  }
  if (err instanceof ChannelSlugConflictError) {
    return new HttpError(409, "CHANNEL_SLUG_CONFLICT", err.message);
  }
  if (err instanceof ChannelMemberExistsError) {
    return new HttpError(409, "CHANNEL_MEMBER_EXISTS", err.message);
  }
  if (err instanceof ChannelLastOwnerError) {
    return new HttpError(409, "CHANNEL_LAST_OWNER", err.message);
  }
  if (err instanceof ChannelInviteeNotMemberError) {
    return new HttpError(422, "CHANNEL_INVITEE_NOT_MEMBER", err.message);
  }
  if (err instanceof ChannelAddresseeNotMemberError) {
    return new HttpError(400, "CHANNEL_ADDRESSEE_NOT_MEMBER", err.message);
  }
  // 400, never a quiet `delivery=none`; the message carries the handles and roster the MCP renders.
  if (err instanceof ChannelRecipientUnresolvedError) {
    return new HttpError(400, "CHANNEL_RECIPIENT_UNRESOLVED", err.message);
  }
  // Same code: to the caller both mean nothing was written and the address needs fixing.
  if (err instanceof ChannelAgentHandleAmbiguousError) {
    return new HttpError(400, "CHANNEL_RECIPIENT_UNRESOLVED", err.message);
  }
  if (err instanceof ChannelTaskNotInChannelError) {
    return new HttpError(400, "CHANNEL_TASK_NOT_IN_CHANNEL", err.message);
  }
  // 404 for all four causes: distinguishing them would probe which message ids are escalations.
  if (err instanceof EscalationNotFoundError) {
    return new HttpError(404, "CHANNEL_ESCALATION_NOT_FOUND", err.message);
  }
  // 403, reached only after the 404 above passed, so it discloses nothing; loud, not a silent strip.
  if (err instanceof EscalationForbiddenError) {
    return new HttpError(403, "CHANNEL_ESCALATION_FORBIDDEN", err.message);
  }
  // 409 from the index's 23505: a second click loses cleanly instead of waking the agent twice.
  if (err instanceof EscalationAlreadyAnsweredError) {
    return new HttpError(409, "CHANNEL_ESCALATION_ANSWERED", err.message);
  }
  // 404 for all three causes: the probe it denies would expose another operator's private turn.
  if (err instanceof DirectionNotFoundError) {
    return new HttpError(404, "CHANNEL_DIRECTION_NOT_FOUND", err.message);
  }
  // 409: the desktop reads it as "stand down", not a fault.
  if (err instanceof DirectionNotClaimableError) {
    return new HttpError(409, "CHANNEL_DIRECTION_NOT_CLAIMABLE", err.message);
  }
  // The one 403 on this lane: the caller proved membership, where the roster and live agents are
  // readable anyway, and a 404 would send an orchestrator to re-launch its own agent.
  if (err instanceof AgentDirectiveForeignError) {
    return new HttpError(403, "CHANNEL_AGENT_FOREIGN", err.message);
  }
  // 404 for "not yours", not 403: a 403 would confirm the id exists.
  if (err instanceof LaunchDirectiveNotFoundError) {
    return new HttpError(404, "LAUNCH_DIRECTIVE_NOT_FOUND", err.message);
  }
  // 409 "stand down": losing the claim CAS is the designed outcome for every machine but one.
  if (err instanceof LaunchDirectiveNotClaimableError) {
    return new HttpError(409, "LAUNCH_DIRECTIVE_NOT_CLAIMABLE", err.message);
  }
  // The agent-identities code, not a channels one: MCP branches on the code to tell a missing
  // identity from a missing channel, both 404s from the same call.
  if (err instanceof LaunchIdentityNotFoundError) {
    // `details` only for a non-leaky fact; absent (not null) otherwise, so its presence signals nothing.
    return new HttpError(
      404,
      "AGENT_IDENTITY_NOT_FOUND",
      err.message,
      err.elsewhere ? { elsewhere: err.elsewhere } : undefined
    );
  }
  // 409 with `details.matches`: the refusal is only actionable with the list, and every match
  // already passed this caller's visibility check.
  if (err instanceof LaunchIdentityAmbiguousError) {
    return new HttpError(409, "AGENT_IDENTITY_AMBIGUOUS", err.message, {
      matches: err.matches,
    });
  }
  // 409, not 400, with `details.free`: the payload is valid and the world moved, so pick again.
  // `free` may be empty (all sixteen out).
  if (err instanceof AgentColorTakenError) {
    return new HttpError(409, "AGENT_COLOR_TAKEN", err.message, {
      free: err.free,
    });
  }
  if (err instanceof ChannelChatAddressedError) {
    return new HttpError(400, "CHANNEL_CHAT_ADDRESSED", err.message);
  }
  // 403 about who may state a lifecycle fact; the MCP side narrates it by code (`channel-errors.ts`).
  if (err instanceof ChannelLifecycleKindForbiddenError) {
    return new HttpError(403, "CHANNEL_LIFECYCLE_KIND_FORBIDDEN", err.message);
  }
  if (err instanceof ConsentNotFoundError) {
    return new HttpError(404, "CONSENT_NOT_FOUND", err.message);
  }
  if (err instanceof ConsentAlreadyDecidedError) {
    return new HttpError(409, "CONSENT_ALREADY_DECIDED", err.message);
  }
  if (err instanceof TaskNotFoundError) {
    return new HttpError(404, "TASK_NOT_FOUND", err.message);
  }
  if (err instanceof TaskForbiddenError) {
    return new HttpError(403, "TASK_FORBIDDEN", err.message);
  }
  if (err instanceof TaskSelfTargetError) {
    return new HttpError(400, "CHANNEL_TASK_SELF_TARGET", err.message);
  }
  if (err instanceof DirectSelfTargetError) {
    return new HttpError(400, "DIRECT_SELF_TARGET", err.message);
  }
  if (err instanceof DirectChannelImmutableError) {
    return new HttpError(400, "DIRECT_CHANNEL_IMMUTABLE", err.message);
  }
  if (err instanceof ChannelInfoCardTooLargeError) {
    return new HttpError(413, "INFO_CARD_TOO_LARGE", err.message);
  }
  return null;
}

export function toChannelErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("channel-route", err, mapChannelError);
}
