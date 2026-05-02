import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { mapSkillError } from "@/features/skills/server/http-mapping";

/**
 * Skills route catch-block helper. Translates domain errors via
 * `mapSkillError`, falls through to HttpError, generic 500 otherwise.
 * Mirrors `toKnowledgeErrorResponse`.
 */
export function toSkillErrorResponse(err: unknown): NextResponse {
  const mapped = mapSkillError(err);
  if (mapped) {
    return NextResponse.json(mapped.toResponseBody(), { status: mapped.status });
  }
  if (err instanceof HttpError) {
    return NextResponse.json(err.toResponseBody(), { status: err.status });
  }
  if (err instanceof Error) {
    console.error("[skill-route] unmapped error:", err);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 }
  );
}
