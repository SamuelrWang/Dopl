import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ingestEntrySkeleton } from "@/features/ingestion/server/skeleton";
import { withAdminAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { assertPublicHttpUrl, UnsafeUrlError } from "@/features/ingestion/server/url-safety";
import { logSystemEvent } from "@/lib/analytics/system-events";

/**
 * Admin-only skeleton ingestion.
 *
 * Runs the lightweight descriptor pipeline in features/ingestion/server/skeleton.ts
 * for mass-indexing public GitHub repos. Bypasses credits (admin), skips
 * moderation queue (auto-approved), and skips the user-scoped dedup
 * filter because admin ingests are the canonical source for skeleton
 * entries.
 *
 * Admin gating is handled by withAdminAuth, which reads ADMIN_USER_ID
 * (same env var the moderation admin routes use). Non-admin callers
 * receive 404 — admin surfaces must be indistinguishable from
 * nonexistent ones so their presence can't be enumerated.
 */

const MAX_URL_LENGTH = 2_048;

const RequestSchema = z.object({
  url: z.string().url(),
});

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    if (parsed.data.url.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        { error: "URL too long", max: MAX_URL_LENGTH },
        { status: 400 }
      );
    }

    try {
      await assertPublicHttpUrl(parsed.data.url);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return NextResponse.json(
          { error: "URL rejected", message: err.message },
          { status: 400 }
        );
      }
      throw err;
    }

    const normalizedUrl = normalizeUrl(parsed.data.url);

    // Dedup against any existing skeleton or full entry for the same
    // URL. Admin re-ingestion is a deliberate action — if you want to
    // refresh a descriptor, delete the row first.
    const supabase = supabaseAdmin();
    const { data: existing } = await supabase
      .from("entries")
      .select("id, slug, status, ingestion_tier, title")
      .in("source_url", [normalizedUrl, parsed.data.url])
      .in("status", ["processing", "complete"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          entry_id: existing.id,
          slug: existing.slug ?? null,
          status: "already_exists",
          tier: existing.ingestion_tier,
          title: existing.title,
        },
        { status: 200 }
      );
    }

    const entryId = await ingestEntrySkeleton({
      url: normalizedUrl,
      userId,
    });

    const { data: newRow } = await supabase
      .from("entries")
      .select("slug")
      .eq("id", entryId)
      .maybeSingle();

    return NextResponse.json(
      {
        entry_id: entryId,
        slug: (newRow as { slug: string | null } | null)?.slug ?? null,
        status: "processing",
        tier: "skeleton",
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const name = error instanceof Error ? error.name : "UnknownError";
    void logSystemEvent({
      severity: "error",
      category: "ingestion",
      source: "POST /api/admin/skeleton-ingest",
      message: `Admin skeleton ingest threw: ${message}`,
      fingerprintKeys: ["admin_skeleton", "endpoint_throw", name],
      metadata: { error_name: name },
      userId,
    });
    return NextResponse.json(
      { error: "Skeleton ingest failed", message },
      { status: 500 }
    );
  }
}

export const POST = withAdminAuth(handlePost);

/** Same normalization rules as /api/ingest — keep dedup consistent. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    const trackingPrefixes = ["utm_", "ref", "source", "fbclid", "gclid"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}
