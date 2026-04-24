import { supabaseAdmin } from "@/shared/supabase/admin";
import { isTweetUrl } from "../extractors/twitter";
import { isInstagramPostUrl } from "../extractors/instagram";
import { isRedditPostUrl } from "../extractors/reddit";

const supabase = supabaseAdmin();

/**
 * Remove a failed/partial entry from the common DB. Deletes child rows
 * explicitly in case FK cascades aren't fully wired up — so no orphaned
 * sources/tags/chunks/logs are left behind.
 */
export async function deleteFailedEntry(entryId: string): Promise<void> {
  try {
    // Children first (no-op if ON DELETE CASCADE is configured)
    await Promise.all([
      supabase.from("chunks").delete().eq("entry_id", entryId),
      supabase.from("sources").delete().eq("entry_id", entryId),
      supabase.from("tags").delete().eq("entry_id", entryId),
      supabase.from("ingestion_logs").delete().eq("entry_id", entryId),
    ]);
    await supabase.from("entries").delete().eq("id", entryId);
  } catch (err) {
    console.error(`[pipeline] Failed to delete partial entry ${entryId}:`, err);
  }
}

/**
 * Map a URL to a short platform identifier. Used for UI badges, analytics
 * tagging, and Chrome-extension routing hints.
 */
export function detectPlatform(url: string): string {
  if (isTweetUrl(url)) return "x";
  if (isInstagramPostUrl(url)) return "instagram";
  if (isRedditPostUrl(url)) return "reddit";
  if (url.includes("github.com")) return "github";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("news.ycombinator.com")) return "hackernews";
  if (url.includes("stackoverflow.com")) return "stackoverflow";
  if (url.includes("medium.com")) return "medium";
  if (url.includes("substack.com") || url.includes(".substack.")) return "substack";
  if (url.includes("dev.to")) return "devto";
  if (url.includes("arxiv.org")) return "arxiv";

  return "web";
}

/**
 * Append a structured row to `ingestion_logs` for later inspection in the
 * admin health dashboard. Non-throwing: if the insert fails, the caller
 * continues — logging failures must not break the pipeline.
 */
export async function logStep(
  entryId: string,
  step: string,
  status: "started" | "completed" | "error",
  details?: Record<string, unknown>,
  durationMs?: number
): Promise<void> {
  await supabase.from("ingestion_logs").insert({
    entry_id: entryId,
    step,
    status,
    details: details || null,
    duration_ms: durationMs || null,
  });
}
