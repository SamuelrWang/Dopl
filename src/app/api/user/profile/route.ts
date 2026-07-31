import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { SAFE_LABEL_RE, safeLabelMessage } from "@/shared/lib/safe-label";

/** The only columns this route ever reads back. */
const PROFILE_COLUMNS =
  "id, display_name, avatar_url, bio, website_url, twitter_handle, github_username, email";

/**
 * Q1-D — `display_name` is the one peer-controlled string that renders into MCP
 * tool output OUTSIDE both the untrusted-body header and the body's two-space
 * indent (`channel-ops-read.ts` `formatAuthor`, at the head of a transcript
 * line). A name carrying a newline therefore forges a whole extra
 * `- **#9001** system · <ts>` row inside another agent's `read` / `await`
 * result. Before this fix nothing bounded the column anywhere — no length, no
 * charset, no newline rule, in this route or in the schema.
 *
 * Bounded HERE **and** by a DB CHECK
 * (`supabase/migrations/20260731090000_profiles_display_name_bounds.sql`),
 * because this route is not the only writer and a route-only fence would be a
 * fence standing next to an open gate:
 *   - RLS `profiles_update_own` (`20260720211005_rls_pin_workspace_member_and_initplan.sql`)
 *     plus the `authenticated` UPDATE grant on the column let any signed-in user
 *     PATCH their own row straight through PostgREST with the anon key.
 *   - the `handle_new_user()` signup trigger copies `raw_user_meta_data`'s
 *     `full_name` / `name` in unfiltered, and that metadata is caller-supplied
 *     at signup.
 *
 * 80 is the repo's human-name tier (`teams.name`, `chats.name` are both
 * `char_length BETWEEN 1 AND 80`). The charset rule mirrors `NAME_RE` in
 * `features/knowledge/schema.ts` minus its `/` ban — that ban exists for the
 * path resolver and has no business restricting a person's name.
 */
const DISPLAY_NAME_MAX = 80;

/**
 * The rule is `SAFE_LABEL_RE` in `@/shared/lib/safe-label` — the single home
 * for the short-label charset rule this route first introduced. It rejects
 * control characters (the newline that forges a transcript line, and every
 * other C0 / DEL byte), zero-width and bidi-override characters, and the
 * line/paragraph separators some renderers still treat as newlines. The copy
 * below is the same sentence, built from the field name.
 */
const DISPLAY_NAME_CHARSET_MESSAGE = safeLabelMessage("Display name");

// `.trim()` runs before the length and charset checks, so a padded name is
// stored tidy and a whitespace-only one is rejected rather than silently
// becoming "". `null` is a legitimate value — the settings form sends it to
// clear the name — hence `.nullable()` rather than a bare string.
const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name cannot be blank")
  .max(DISPLAY_NAME_MAX, `Display name must be ${DISPLAY_NAME_MAX} characters or less`)
  .regex(SAFE_LABEL_RE, DISPLAY_NAME_CHARSET_MESSAGE)
  .nullable();

/**
 * Replaces the old hand-rolled `allowedFields` loop. zod strips unknown keys,
 * so the allow-list property is preserved — but now every accepted field is
 * also bounded. Only `display_name` gets a charset rule: it is the only one
 * that renders into agent-facing narration, and a bio is legitimately
 * multi-line. The rest are capped for storage sanity.
 */
const ProfilePatchSchema = z.object({
  display_name: DisplayNameSchema.optional(),
  bio: z.string().trim().max(2000).nullable().optional(),
  website_url: z.string().trim().max(500).nullable().optional(),
  twitter_handle: z.string().trim().max(40).nullable().optional(),
  github_username: z.string().trim().max(40).nullable().optional(),
});

/**
 * ENGINEERING §9 envelope. `parseJson` reports every zod failure as the generic
 * "Request body failed validation"; the settings form shows `message` verbatim,
 * so the first issue's own text is promoted into it ("Display name must be 80
 * characters or less") while the full issue list stays in `details`.
 */
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
  const message = err instanceof Error ? err.message : "Unknown error";
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message } },
    { status: 500 }
  );
}

/**
 * GET /api/user/profile — Get the current user's profile.
 */
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

/**
 * PATCH /api/user/profile — Update the current user's profile.
 *
 * Body: { display_name?, bio?, website_url?, twitter_handle?, github_username? }
 * Every field is optional; `null` clears it. Unknown keys are dropped.
 */
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
      // An absent key must not be written as NULL — only an explicit `null`
      // clears a field, and zod leaves omitted optionals as `undefined`.
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
