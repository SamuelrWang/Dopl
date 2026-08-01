import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  ChannelAddresseeNotMemberError,
  ChannelAgentForbiddenError,
  ChannelAgentNameConflictError,
  ChannelAgentNotFoundError,
  ChannelAgentNotInChannelError,
  ChannelForbiddenError,
  ChannelInviteeNotMemberError,
  ChannelLastOwnerError,
  ChannelMemberExistsError,
  ChannelNotFoundError,
  ChannelParticipantNotMemberError,
  ChannelSlugConflictError,
  ChannelTaskNotInChannelError,
  ConsentAlreadyDecidedError,
  ConsentNotFoundError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
  TrustedNotMemberError,
  TrustSelfError,
} from "./errors";

/**
 * Maps channel domain errors to `HttpError`. Returns `null` for anything
 * it doesn't own so the shared tail (`toHttpErrorResponse`) can fall
 * through to the generic 500.
 */
export function mapChannelError(err: unknown): HttpError | null {
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
  if (err instanceof ChannelTaskNotInChannelError) {
    return new HttpError(400, "CHANNEL_TASK_NOT_IN_CHANNEL", err.message);
  }
  if (err instanceof ChannelAgentNotFoundError) {
    return new HttpError(404, "CHANNEL_AGENT_NOT_FOUND", err.message);
  }
  if (err instanceof ChannelAgentNotInChannelError) {
    return new HttpError(400, "CHANNEL_AGENT_NOT_IN_CHANNEL", err.message);
  }
  if (err instanceof ChannelAgentNameConflictError) {
    return new HttpError(409, "CHANNEL_AGENT_NAME_CONFLICT", err.message);
  }
  if (err instanceof ChannelAgentForbiddenError) {
    return new HttpError(403, "CHANNEL_AGENT_FORBIDDEN", err.message);
  }
  if (err instanceof ChannelParticipantNotMemberError) {
    return new HttpError(400, "CHANNEL_PARTICIPANT_NOT_MEMBER", err.message);
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
  if (err instanceof TrustSelfError) {
    return new HttpError(400, "TRUST_SELF", err.message);
  }
  if (err instanceof TrustedNotMemberError) {
    return new HttpError(422, "TRUST_NOT_MEMBER", err.message);
  }
  return null;
}

export function toChannelErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("channel-route", err, mapChannelError);
}
