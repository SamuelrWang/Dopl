import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth/with-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { normalizeUrl } from "@/lib/ingestion/url";

export const dynamic = "force-dynamic";

const supabase = supabaseAdmin();

/**
 * GET /api/ingest/content/:entry_id[?source_url=...]
 *
 * Returns the extracted content the agent needs to run ingestion prompts.
 * Replaces the legacy `gathered_content` blob that used to ride on the
 * prepare response — pulling it here instead of inlining keeps the
 * prepare response O(num_sources) rather than O(content_size), and
 * lets the agent target one source (e.g. just the README) per prompt
 * to save tokens.
 *
 * Auth: `withUserAuth`. Access is granted when the entry is owned by
 * the caller OR is publicly approved — same gate used by /api/entries
 * so existing entries remain viewable and ingestion-in-progress entries
 * are visible to the agent that started them.
 *
 * Contract:
 *   - 200 { entry_id, source_url, content, chars, truncated }
 *   - 404 { error } — entry doesn't exist or caller has no access
 *   - 404 { error } — if ?source_url is passed but no matching source row
 *
 * A 90KB content cap applies. The MCP tool-result surface rejects
 * responses above roughly 100KB (the heygen walkthrough hit this at
 * 295KB), so we cap well under that and leave room for the envelope.
 * If the concatenated content exceeds the cap we return a slice with
 * `truncated: true` — the agent should then narrow to specific sources
 * via `?source_url` rather than pulling everything at once.
 */

const MAX_CONTENT_CHARS = 90_000;

interface SourceRow {
  url: string | null;
  normalized_url: string | null;
  source_type: string;
  depth: number;
  extracted_content: string | null;
  raw_content: string | null;
}

async function handleGet(
  request: NextRequest,
  { userId, params }: { userId: string; params?: Record<string, string> }
) {
  const entryId = params?.entry_id;
  if (!entryId) {
    return NextResponse.json({ error: "Missing entry_id" }, { status: 400 });
  }

  // Access gate: owned by caller OR publicly moderated='approved'. We
  // fetch the entry row first and reject before touching `sources` so a
  // probe for a non-visible entry can't read its source list.
  const { data: entry } = await supabase
    .from("entries")
    .select("id, ingested_by, moderation_status")
    .eq("id", entryId)
    .maybeSingle();

  if (!entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }
  const entryRow = entry as {
    id: string;
    ingested_by: string | null;
    moderation_status: string | null;
  };
  const isOwner = entryRow.ingested_by === userId;
  const isPublic = entryRow.moderation_status === "approved";
  if (!isOwner && !isPublic) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sourceUrlParam = url.searchParams.get("source_url");

  if (sourceUrlParam) {
    // Single-source fetch. Normalize the requested URL to match what
    // `storeSources` wrote into `normalized_url` at ingestion time.
    //
    // Only query by normalized_url (not OR-ing with raw url) — PostgREST's
    // `.or()` uses `.` and `,` as delimiters, both of which appear in
    // URLs, so an OR expression containing a URL is unsafe. For fresh
    // ingests this is lossless: the extractors now store normalized URLs
    // in sources.url too, so callers passing the URL they saw in
    // `sources[].url` from prepare always land on a match. Legacy rows
    // with un-stripped tracking params will miss — acceptable since
    // those entries pre-date the refactor.
    const normalizedTarget = normalizeUrl(sourceUrlParam);
    const { data: row } = await supabase
      .from("sources")
      .select("url, normalized_url, source_type, depth, extracted_content, raw_content")
      .eq("entry_id", entryId)
      .eq("status", "ok")
      .eq("normalized_url", normalizedTarget)
      .order("depth", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        { error: "Source not found for entry" },
        { status: 404 }
      );
    }

    const r = row as SourceRow;
    const body = r.extracted_content ?? r.raw_content ?? "";
    const truncated = body.length > MAX_CONTENT_CHARS;
    return NextResponse.json({
      entry_id: entryId,
      source_url: r.url,
      content: truncated ? body.slice(0, MAX_CONTENT_CHARS) : body,
      chars: body.length,
      truncated,
    });
  }

  // All-sources fetch: concat every status='ok' source in depth order,
  // same shape `buildGatheredContent` used to produce. Depth-ordered so
  // the primary URL leads, followed links follow.
  const { data: rows } = await supabase
    .from("sources")
    .select("url, normalized_url, source_type, depth, extracted_content, raw_content")
    .eq("entry_id", entryId)
    .eq("status", "ok")
    .order("depth", { ascending: true })
    .order("created_at", { ascending: true });

  const parts: string[] = [];
  for (const row of (rows ?? []) as SourceRow[]) {
    const body = row.extracted_content ?? row.raw_content ?? "";
    if (body.length === 0) continue;
    const header = row.url
      ? `--- [${row.source_type}] ${row.url} (depth: ${row.depth}) ---`
      : `--- [${row.source_type}] (depth: ${row.depth}) ---`;
    parts.push(`${header}\n${body}`);
  }

  const combined = parts.join("\n\n");
  const truncated = combined.length > MAX_CONTENT_CHARS;
  return NextResponse.json({
    entry_id: entryId,
    source_url: null,
    content: truncated ? combined.slice(0, MAX_CONTENT_CHARS) : combined,
    chars: combined.length,
    truncated,
  });
}

export const GET = withUserAuth(handleGet);
