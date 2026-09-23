import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { mapAgentIdentityError } from "@/features/agent-identities/server/http-mapping";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { isUuid } from "@/shared/lib/id/uuid";

/** Route catch-block helper: `mapAgentIdentityError`, then `HttpError`, then a generic 500. */
export function toAgentIdentityErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("agent-identity-route", err, mapAgentIdentityError);
}

/** Validates `[identityId]`. Identities are addressed by UUID, not slug (unlike skills): a slug's
 *  uniqueness would only make two people's same-named private identities collide. */
export function requireIdentityId(
  params: Record<string, string> | undefined
): string {
  const raw = params?.identityId;
  if (!raw || !isUuid(raw)) {
    throw HttpError.badRequest("Invalid agent identity id");
  }
  return raw;
}
