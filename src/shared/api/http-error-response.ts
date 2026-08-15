import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";

/**
 * Generic catch-block helper for route features. With `mapDomainError`, domain
 * errors translate first; anything unrecognized falls through to the `HttpError`
 * pass-through and finally a generic 500, so DB internals never leak
 * (ENGINEERING §9). Feature helpers (`toKnowledgeErrorResponse`,
 * `toChatErrorResponse`, `toSkillErrorResponse`) delegate here with their mapper.
 *
 * ⚠ THE `console.error` BELOW IS THE ONLY RECORD OF THE CAUSE. Routes using this
 * helper RETURN their 500, so `runAndLog5xx` takes its response branch and
 * writes only `"5xx response: <status>"` + a `status_code`. The message, name
 * and stack exist solely on process stdout.
 *
 * ⚠ Do NOT "fix" that by calling `logSystemEvent` here: it pulls
 * `@/shared/supabase/admin`, which THROWS at module evaluation on a missing
 * `NEXT_PUBLIC_SUPABASE_URL`, into a helper ~84 route modules import. The wiring
 * belongs with the routes that own their auth wrapper.
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
