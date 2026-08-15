import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { SAFE_LABEL_RE, safeLabelMessage } from "@/shared/lib/safe-label";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";

/** The only columns this route ever reads back. */
const PROFILE_COLUMNS =
  "id, display_name, avatar_url, bio, website_url, twitter_handle, github_username, email";

/**
 * ⚠ `display_name` is the one peer-controlled string MCP tool output renders OUTSIDE both the
 * untrusted-body header and the body's two-space indent (`channel-ops-read.ts` `formatAuthor`,
 * at the HEAD of a transcript line). A newline in it forges a whole extra
 * `- **#9001** system · <ts>` row inside another agent's `read`/`await` result.
 *
 * ⚠ Bounded HERE **and** by a DB CHECK
 * (`supabase/migrations/20260731090000_profiles_display_name_bounds.sql`) — this route is not the
 * only writer: RLS `profiles_update_own` + the `authenticated` UPDATE grant let any signed-in
 * user PATCH through PostgREST with the anon key, and the `handle_new_user()` trigger copies
 * caller-supplied `raw_user_meta_data`.
 *
 * 80 = the repo's human-name tier (`teams.name`, `chats.name`). Charset mirrors `NAME_RE` in
 * `features/knowledge/schema.ts` minus its `/` ban (a path-resolver rule, not a name rule).
 */
const DISPLAY_NAME_MAX = 80;

/** `SAFE_LABEL_RE` (`@/shared/lib/safe-label`) rejects C0/DEL control characters, zero-width and
 *  bidi-override characters, and the line/paragraph separators some renderers treat as newlines. */
const DISPLAY_NAME_CHARSET_MESSAGE = safeLabelMessage("Display name");

// ⚠ `.trim()` runs BEFORE the length and charset checks, so a whitespace-only name is rejected
// rather than silently becoming "". `null` is legitimate — the settings form sends it to clear.
const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name cannot be blank")
  .max(DISPLAY_NAME_MAX, `Display name must be ${DISPLAY_NAME_MAX} characters or less`)
  .regex(SAFE_LABEL_RE, DISPLAY_NAME_CHARSET_MESSAGE)
  .nullable();

/** zod strips unknown keys (the allow-list). Only `display_name` gets a charset rule — it is the
 *  only field rendering into agent-facing narration; a bio is legitimately multi-line. */
const ProfilePatchSchema = z.object({
  display_name: DisplayNameSchema.optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  website_url: z.string().trim().max(500).nullable().optional(),
  twitter_handle: z.string().trim().max(40).nullable().optional(),
  github_username: z.string().trim().max(40).nullable().optional(),
});

/** ENGINEERING §9 envelope. `parseJson`'s generic message is replaced by the first issue's own
 *  text, since the settings form shows `message` verbatim; full list stays in `details`. */
function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    const body = err.toResponseBody();
    const issues = err.details;
    if (Array.isArray(issues) && issues.length > 0) {
      const first = issues[0] as { message?: unknown };
      if (typeof first?.message === "string" && first.message) {
        body.error.message = first.message;
      }
    }
    return NextResponse.json(body, { status: err.status });
  }
  return toHttpErrorResponse("api/user/profile", err);
}

/** GET /api/user/profile */
async function handleGet(
  _request: NextRequest,
  context: { userId: string }
) {
  try {
    const db = supabaseAdmin();
    const { data: profile, error } = await db
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", context.userId)
      .single();

    if (error || !profile) {
      throw HttpError.notFound("Profile not found");
    }

    return NextResponse.json(profile);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PATCH /api/user/profile. Every field optional; `null` clears it; unknown keys dropped. */
async function handlePatch(
  request: NextRequest,
  context: { userId: string }
) {
  try {
    const input = await parseJson(request, ProfilePatchSchema);
    const db = supabaseAdmin();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const [field, value] of Object.entries(input)) {
      // ⚠ An absent key must not be written as NULL — only an explicit `null` clears a field.
      if (value !== undefined) updates[field] = value;
    }

    const { data: profile, error } = await db
      .from("profiles")
      .update(updates)
      .eq("id", context.userId)
      .select(PROFILE_COLUMNS)
      .single();

    if (error || !profile) {
      throw new HttpError(500, "INTERNAL_ERROR", "Failed to update profile");
    }

    return NextResponse.json(profile);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const GET = withUserAuth(handleGet);
export const PATCH = withUserAuth(handlePatch);
