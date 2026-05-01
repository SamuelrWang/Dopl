import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { mapKnowledgeError } from "@/features/knowledge/server/http-mapping";

/**
 * Knowledge-feature catch-block helper. Translates domain errors via
 * `mapKnowledgeError`, falls through to `HttpError` directly (e.g. from
 * `parseJson`), and returns a generic 500 for anything else.
 *
 * Mirrors `toErrorResponse` in clusters/route.ts but layered so the
 * knowledge-specific mapping runs first.
 */
export function toKnowledgeErrorResponse(err: unknown): NextResponse {
  const mapped = mapKnowledgeError(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  // Don't leak the raw error message to the client — could expose DB
  // internals, file paths, or PII inside dynamic SQL strings (ENGINEERING
  // §9). The full error gets logged via the auth wrapper's 5xx
  // system_events trail; clients see a generic 500.
  if (err instanceof Error) {
    console.error("[knowledge-route] unmapped error:", err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
