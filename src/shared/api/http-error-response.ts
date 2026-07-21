import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Generic catch-block helper for route features. When `mapDomainError`
 * is supplied, domain errors are translated first; anything it doesn't
 * recognize (returns `null`) falls through to the `HttpError`
 * pass-through and finally a generic 500 so DB internals never leak to
 * the client (ENGINEERING §9). Features without a domain-error mapping
 * layer omit `mapDomainError` and rely on the `HttpError` path.
 *
 * The feature-specific helpers (`toKnowledgeErrorResponse`,
 * `toChatErrorResponse`, `toSkillErrorResponse`) delegate here with
 * their own mapper so the shared tail lives in one place.
 */
export function toHttpErrorResponse(
  source: string,
  err: unknown,
  mapDomainError?: (err: unknown) => HttpError | null
): NextResponse {
  const mapped = mapDomainError?.(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  if (err instanceof Error) {
    console.error(`[${source}] unmapped error:`, err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
