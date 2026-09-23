import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { mapAgentIdentityError } from "@/features/agent-identities/server/http-mapping";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/** Agent-identity route catch-block helper: `mapAgentIdentityError`, then
 *  HttpError, then a generic 500. The fifth feature wrapper around
 *  `toHttpErrorResponse`, alongside `toKnowledgeErrorResponse`,
 *  `toChatErrorResponse`, `toSkillErrorResponse` and `toChannelErrorResponse`. */
export function toAgentIdentityErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("agent-identity-route", err, mapAgentIdentityError);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the `[identityId]` route param.
 *
 * ⚠ IDENTITIES ARE ADDRESSED BY UUID, NOT BY SLUG, AND THAT IS A DEPARTURE FROM
 * `skills` WORTH ONE SENTENCE: a skill's slug is part of its agent-facing
 * contract (`dopl://kb/<slug>` refs, `skill_get` by name), so it earns a
 * human-readable, renameable, collision-managed identifier. An identity is
 * selected from a picker and then referenced by id forever; a slug would add a
 * uniqueness constraint whose only job is to make two people's private
 * "Researcher" identities collide.
 */
export function requireIdentityId(
  params: Record<string, string> | undefined
): string {
  const raw = params?.identityId;
  if (!raw || !UUID_RE.test(raw)) {
    throw HttpError.badRequest("Invalid agent identity id");
  }
  return raw;
}
