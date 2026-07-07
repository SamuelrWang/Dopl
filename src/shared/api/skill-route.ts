import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { SkillSlugSchema } from "@/features/skills/schema";
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates the [versionId] route param (skill version endpoints). */
export function requireVersionId(params: Record<string, string> | undefined): string {
  const raw = params?.versionId;
  if (!raw || !UUID_RE.test(raw)) {
    throw HttpError.badRequest("Invalid version id");
  }
  return raw;
}

/** Validates the [skillSlug] route param (shared by every skill route). */
export function requireSkillSlug(params: Record<string, string> | undefined): string {
  const result = SkillSlugSchema.safeParse(params?.skillSlug ?? "");
  if (!result.success) throw HttpError.badRequest("Invalid skill slug");
  return result.data;
}
