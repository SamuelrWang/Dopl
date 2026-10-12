import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "@/shared/lib/http-error";
import { SkillSlugSchema } from "@/features/skills/schema";
import { mapSkillError } from "@/features/skills/server/http-mapping";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { isUuid } from "@/shared/lib/id/uuid";

/** Skills route catch-block helper: `mapSkillError`, then HttpError, then a
 *  generic 500. Mirrors `toKnowledgeErrorResponse`. */
export function toSkillErrorResponse(err: unknown): NextResponse {
  return toHttpErrorResponse("skill-route", err, mapSkillError);
}

/** Validates the [versionId] route param (skill version endpoints).
 *  ⚠ Same rationale as `channel-route.ts › requireConsentId`: `versionId` lands
 *  in a `uuid =` filter, so an unvalidated non-UUID reaches Postgres as a 22P02
 *  cast failure (generic 500 + a `system_events` row per call). */
export function requireVersionId(params: Record<string, string> | undefined): string {
  const raw = params?.versionId;
  if (!raw || !isUuid(raw)) {
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
