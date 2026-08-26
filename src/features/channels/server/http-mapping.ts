import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import {
  ChannelAddresseeNotMemberError,
  ChannelChatAddressedError,
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
  ConsentNotFoundError,
  DirectChannelImmutableError,
  DirectSelfTargetError,
  LaunchDirectiveNotClaimableError,
  LaunchDirectiveNotFoundError,
  LaunchTemplateAmbiguousError,
  LaunchTemplateNotFoundError,
  TaskForbiddenError,
  TaskNotFoundError,
  TaskSelfTargetError,
} from "./errors";

/**
 * Maps channel domain errors to `HttpError`. Returns `null` for anything
 * it doesn't own so the shared tail (`toHttpErrorResponse`) can fall
 * through to the generic 500.
 */
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
  if (err instanceof ChannelTaskNotInChannelError) {
    return new HttpError(400, "CHANNEL_TASK_NOT_IN_CHANNEL", err.message);
  }
  // ⚠ 404 FOR "not yours", not 403 — see the error's own docblock. A 403 would
  // confirm the id exists, which is exactly the probe the single error prevents.
  if (err instanceof LaunchDirectiveNotFoundError) {
    return new HttpError(404, "LAUNCH_DIRECTIVE_NOT_FOUND", err.message);
  }
  // ⚠ 409, and the desktop lane reads it as "stand down", NOT as a fault: losing
  // the claim CAS is the designed outcome for every machine but one.
  if (err instanceof LaunchDirectiveNotClaimableError) {
    return new HttpError(409, "LAUNCH_DIRECTIVE_NOT_CLAIMABLE", err.message);
  }
  // ⚠ 404 AND THE AGENT-TEMPLATES CODE, not a channels-flavoured one. The `/resolve`
  // endpoint answers `AGENT_TEMPLATE_NOT_FOUND` for the same fact, and the MCP layer
  // branches on the CODE to tell a missing TEMPLATE from a missing CHANNEL — both of
  // which arrive here as a 404 from the same call.
  if (err instanceof LaunchTemplateNotFoundError) {
    return new HttpError(404, "AGENT_TEMPLATE_NOT_FOUND", err.message);
  }
  // ⚠ 409 WITH `details.matches`, because the REFUSAL IS ONLY USEFUL WITH THE LIST.
  // "That name is ambiguous" with nothing else forces the caller to guess or to go
  // read the template list through another tool; the ids it needs are already in
  // hand and every one of them passed this caller's own visibility check.
  if (err instanceof LaunchTemplateAmbiguousError) {
    return new HttpError(409, "AGENT_TEMPLATE_AMBIGUOUS", err.message, {
      matches: err.matches,
    });
  }
  // SIX ARMS ENDED HERE (channels rollback §1) and each was a named-agent or
  // breakout-room refusal: CHANNEL_AGENT_NOT_FOUND / _NOT_IN_CHANNEL /
  // _NAME_CONFLICT / _FORBIDDEN, CHANNEL_TOO_MANY_AGENTS and
  // CHANNEL_PARTICIPANT_NOT_MEMBER. Nothing raises them now, and the MCP side
  // dropped the classifier kinds that read them. A caller that still sends a
  // removed PARAM gets VALIDATION_FAILED from the route schema, which names the
  // field — see `schema.ts#removedParam`.
  if (err instanceof ChannelChatAddressedError) {
    return new HttpError(400, "CHANNEL_CHAT_ADDRESSED", err.message);
  }
  // P0-2 (2026-08-04). A 403 about WHO may make a statement rather than about
  // whether the payload parses, carrying a code the MCP side reads to narrate
  // the refusal in the agent's own terms (`channel-errors.ts`) instead of
  // guessing from the status.
  //
  // ⚠ `CHANNEL_CLOSE_IS_HUMAN_ONLY` was its twin (DECISION 2) and went with
  // thread closing (wiring plan Phase 4, 2026-08-18) — no close, so no
  // human-only close lane to refuse an agent from.
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
