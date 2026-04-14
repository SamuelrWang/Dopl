import { NextRequest, NextResponse } from "next/server";
import { IngestRequestSchema } from "@/types/api";
import { ingestEntry } from "@/lib/ingestion/pipeline";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { MAX_CONTENT_FOR_CLAUDE, MAX_IMAGES_PER_ENTRY, MAX_IMAGE_SIZE_BYTES } from "@/lib/config";

const MAX_LINKS = 50;
const MAX_URL_LENGTH = 2_048;

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const parsed = IngestRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    // -- Input size validation --
    if (parsed.data.url.length > MAX_URL_LENGTH) {
      return NextResponse.json(
        { error: "URL too long", max: MAX_URL_LENGTH },
        { status: 400 }
      );
    }

    if (parsed.data.content.text && parsed.data.content.text.length > MAX_CONTENT_FOR_CLAUDE) {
      return NextResponse.json(
        { error: "Text content too long", max: MAX_CONTENT_FOR_CLAUDE },
        { status: 400 }
      );
    }

    if (parsed.data.content.images && parsed.data.content.images.length > MAX_IMAGES_PER_ENTRY) {
      return NextResponse.json(
        { error: `Too many images (max ${MAX_IMAGES_PER_ENTRY})` },
        { status: 400 }
      );
    }

    if (parsed.data.content.images) {
      for (const img of parsed.data.content.images) {
        if (img.length > MAX_IMAGE_SIZE_BYTES) {
          return NextResponse.json(
            { error: "Image too large (max 10MB)" },
            { status: 400 }
          );
        }
      }
    }

    if (parsed.data.content.links && parsed.data.content.links.length > MAX_LINKS) {
      return NextResponse.json(
        { error: `Too many links (max ${MAX_LINKS})` },
        { status: 400 }
      );
    }

    // ── Dedup check: has this URL already been ingested? ──────────
    const normalizedUrl = normalizeUrl(parsed.data.url);
    const supabase = supabaseAdmin();
    // Check both normalized and raw URL to catch old entries
    const urlsToCheck = [normalizedUrl];
    if (parsed.data.url !== normalizedUrl) urlsToCheck.push(parsed.data.url);
    const { data: existing } = await supabase
      .from("entries")
      .select("id, title, status")
      .in("source_url", urlsToCheck)
      .in("status", ["complete", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // URL already ingested — return the existing entry directly
      return NextResponse.json(
        {
          entry_id: existing.id,
          status: existing.status === "complete" ? "already_exists" : "processing",
          title: existing.title,
          stream_url: existing.status === "processing"
            ? `/api/ingest/${existing.id}/stream`
            : undefined,
        },
        { status: 200 }
      );
    }

    // ── New ingestion ───────────────────────────────────────────
    const entryId = await ingestEntry({
      url: normalizedUrl,
      content: {
        text: parsed.data.content.text,
        images: parsed.data.content.images,
        links: parsed.data.content.links,
      },
    });

    return NextResponse.json(
      {
        entry_id: entryId,
        status: "processing",
        stream_url: `/api/ingest/${entryId}/stream`,
      },
      { status: 202 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Ingestion failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);

/**
 * Normalize a URL for dedup comparison.
 * Strips trailing slashes, query params like utm_*, and lowercases the host.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    // Remove common tracking params
    const trackingPrefixes = ["utm_", "ref", "source", "fbclid", "gclid"];
    for (const key of [...u.searchParams.keys()]) {
      if (trackingPrefixes.some((p) => key.startsWith(p))) {
        u.searchParams.delete(key);
      }
    }
    // Remove trailing slash
    let result = u.toString();
    if (result.endsWith("/") && u.pathname !== "/") {
      result = result.slice(0, -1);
    }
    return result;
  } catch {
    return url;
  }
}
