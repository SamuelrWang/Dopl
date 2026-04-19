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
 * A 60KB content cap applies. Empirically the MCP tool-result surface
 * rejected a 90,113-char response during verification (the harness
 * caps in tokens, which varies with content density). 60KB gives a
 * safe margin well under any realistic per-response ceiling while
 * still covering most single-source fetches. If the concatenated
 * content exceeds the cap we return a slice with `truncated: true`
 * and the agent pivots to per-source fetches via `?source_url` —
 * which is the preferred per-prompt pattern anyway since it lets the
 * agent target exactly the content a given step needs (README for
 * content-type classification, code-heavy sources for manifest tool
 * extraction, etc.) at lower token cost.
 */

const MAX_CONTENT_CHARS = 60_000;

/**
 * Entry-ID validator. The `entry_id` path param is supposed to be a
 * UUID written by `prepare_ingest`. A non-UUID string reaching the
 * Supabase query would surface as a 500 (`invalid input syntax for
 * type uuid`) — confusing diagnostic noise and a vector for probes.
 * Returning 400 up front keeps the 500 surface clean for real errors.
 *
 * Permissive regex: accepts the canonical 8-4-4-4-12 hex form. The
 * DB accepts any variant; this is just a sanity gate.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID_REGEX.test(entryId)) {
    return NextResponse.json(
      { error: "Invalid entry_id (expected UUID)" },
      { status: 400 }
    );
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
