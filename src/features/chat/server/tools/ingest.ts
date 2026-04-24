import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { isAdmin } from "@/shared/auth/with-auth";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/features/ingestion/server/url-safety";
import { detectPlatform } from "@/features/ingestion/server/pipeline";
import { fallbackSlugFromId } from "@/lib/entries/slug";
import { normalizeUrl } from "./url-normalize";
import type { ToolResult } from "./types";

const supabase = supabaseAdmin();

/**
 * Tool: ingest_url — queue a URL for ingestion by the user's connected
 * MCP agent (or return an existing entry if already queued/processing/
 * complete). Validates URL format, runs SSRF guard, and dedups against
 * the entries table scoped to the caller.
 *
 * Queuing is intentionally FREE — the access gate runs in
 * /api/ingest/prepare when the agent actually claims the pending entry.
 * Letting expired-trial users queue means the "upgrade to process"
 * prompt fires at the right moment (claim time), not at paste time.
 */
export async function executeIngestUrl(
  input: Record<string, unknown>,
  userId?: string
): Promise<ToolResult> {
  const rawUrl = input.url as string;

  // Validate the URL before any DB lookups / ingestion work. Keeps
  // malformed or oversized URLs out of the pipeline.
  if (!rawUrl || typeof rawUrl !== "string") {
    return {
      result: JSON.stringify({ status: "error", message: "url is required" }),
    };
  }
  if (rawUrl.length > 2048) {
    return {
      result: JSON.stringify({
        status: "error",
        message: "URL too long (max 2048 chars)",
      }),
    };
  }
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return {
        result: JSON.stringify({
          status: "error",
          message: `Unsupported URL scheme: ${u.protocol}`,
        }),
      };
    }
  } catch {
    return {
      result: JSON.stringify({ status: "error", message: "Invalid URL" }),
    };
  }

  // SSRF guard: refuse private / metadata / loopback URLs before we
  // burn credits or create DB rows.
  try {
    await assertPublicHttpUrl(rawUrl);
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      return {
        result: JSON.stringify({ status: "error", message: err.message }),
      };
    }
    throw err;
  }

  const normalizedUrl = normalizeUrl(rawUrl);

  // Dedup check — mirrors /api/ingest/route.ts so chat and direct
  // ingestion behave the same. Considers three statuses:
  //   - complete / processing → return already_exists / processing
  //   - pending_ingestion (user's own) → return the existing skeleton
  //     so a user who pastes the same URL twice doesn't get duplicate
  //     amber tiles.
  // Only match (a) approved public entries OR (b) the calling user's
  // own pending/processing entries to avoid cross-user leak.
  const urlsToCheck = [normalizedUrl];
  if (rawUrl !== normalizedUrl) urlsToCheck.push(rawUrl);
  let existingQuery = supabase
    .from("entries")
    .select("id, title, status, updated_at")
    .in("source_url", urlsToCheck)
    .in("status", ["complete", "processing", "pending_ingestion"]);
  if (userId) {
    existingQuery = existingQuery.or(
      `moderation_status.eq.approved,and(ingested_by.eq.${userId},moderation_status.neq.denied)`
    );
  } else {
    // No userId context — only reuse publicly approved entries.
    existingQuery = existingQuery.eq("moderation_status", "approved");
  }
  const { data: existing } = await existingQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (existing.status === "pending_ingestion") {
      // Same user re-pasted a URL already queued. Don't create a
      // duplicate skeleton — surface the existing one.
      return {
        result: JSON.stringify({
          entry_id: existing.id,
          status: "queued",
          url: normalizedUrl,
          title: existing.title ?? null,
          message:
            "Already queued. Your connected agent will pick it up on its next tool call.",
        }),
      };
    }
    if (existing.status === "processing") {
      const updatedAt = new Date(existing.updated_at).getTime();
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      if (updatedAt >= oneHourAgo) {
        // Still actively processing
        return {
          result: JSON.stringify({
            entry_id: existing.id,
            status: "processing",
            title: existing.title,
            stream_url: `/api/ingest/${existing.id}/stream`,
          }),
        };
      }
      // Zombie — reset and fall through to new ingestion
      await supabase
        .from("entries")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      // Already complete
      return {
        result: JSON.stringify({
          entry_id: existing.id,
          status: "already_exists",
          title: existing.title,
        }),
      };
    }
  }

  // No matching entry — queue a skeleton row. The user's connected
  // MCP agent discovers it via the `_dopl_status` footer on its next
  // tool call and claims it through `prepare_ingest` (which flips
  // pending_ingestion → processing atomically).
  if (!userId) {
    // Canvas is auth-gated, so this branch is effectively unreachable
    // for real users. Return an error rather than an orphan skeleton.
    return {
      result: JSON.stringify({
        status: "error",
        message: "Sign in to queue URLs for ingestion.",
      }),
    };
  }

  const entryId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("entries").insert({
    id: entryId,
    source_url: normalizedUrl,
    source_platform: detectPlatform(normalizedUrl),
    status: "pending_ingestion",
    ingested_by: userId,
    slug: fallbackSlugFromId(entryId),
    // Admin-queued URLs skip moderation — once the agent claims
    // them via prepare, they'll already be approved and visible
    // to everyone. Non-admins default to "pending".
    ...(isAdmin(userId) ? { moderation_status: "approved" } : {}),
  });
  if (insertError) {
    return {
      result: JSON.stringify({
        status: "error",
        message: `Failed to queue URL: ${insertError.message}`,
      }),
    };
  }

  return {
    result: JSON.stringify({
      status: "queued",
      entry_id: entryId,
      slug: fallbackSlugFromId(entryId),
      url: normalizedUrl,
      message:
        "URL queued. Your connected MCP agent will ingest it on its next tool call.",
    }),
  };
}
