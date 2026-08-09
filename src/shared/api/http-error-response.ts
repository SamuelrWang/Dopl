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
 *
 * THE `console.error` BELOW IS THE ONLY RECORD OF THE CAUSE. Say it plainly,
 * because the swept routes read as if something durable were catching these.
 * `withUserAuth`'s `runAndLog5xx` writes a `system_events` row on a THROWN
 * escape (message, error name) AND on a 5xx RESPONSE — but the response branch
 * writes only `"5xx response: <status>"` plus a `status_code`. Every route
 * using this helper RETURNS its 500, so it always takes that second branch:
 * the durable trail proves a 500 occurred and says nothing about what threw.
 * The message, name and stack exist solely on process stdout.
 *
 * NOT FIXED HERE, deliberately. Calling `logSystemEvent` from this module
 * would pull `@/shared/supabase/admin` — which THROWS at module evaluation on
 * a missing `NEXT_PUBLIC_SUPABASE_URL` — into a `shared/` helper that ~84
 * route modules import, so every route test touching an error path would need
 * the analytics mock it does not have today. The honest note is the smaller
 * change; the wiring belongs with the routes that own their auth wrapper.
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
