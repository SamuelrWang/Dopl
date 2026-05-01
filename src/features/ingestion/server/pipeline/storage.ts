import { supabaseAdmin } from "@/shared/supabase/admin";
import { ExtractedSource } from "../types";
import { normalizeUrl } from "../url";
import { slugifyEntryTitle, fallbackSlugFromId } from "@/features/entries/server/slug";

const supabase = supabaseAdmin();

/**
 * Upsert one or more source rows for an entry, with concurrency-safe
 * URL dedup. Two callers storing the same url for the same entry won't
 * race each other into a unique-constraint violation: we pre-filter by
 * `(entry_id, normalized_url)` with status='ok', and fall back to
 * single-row inserts on a 23505 batch conflict so one lost race doesn't
 * drop the other rows in the batch.
 *
 * Failed/skipped rows (status !== 'ok') and rows without a URL bypass
 * dedup and are always inserted — they record audit trail for fetch
 * problems, not content.
 *
 * On unexpected DB errors, surfaces code/details/hint from the
 * PostgrestError so the root cause is debuggable without re-running
 * the pipeline under a debugger. One class of error we swallow: 23505
 * (unique_violation) from concurrent writers of the same URL — those
 * are expected at high concurrency and we log it as a duplicate
 * without raising.
 */
export async function storeSources(
  entryId: string,
  sources: ExtractedSource[]
): Promise<void> {
  if (sources.length === 0) return;

  const allRows = sources.map((source) => {
    const normalized =
      source.url && source.url.length > 0 ? normalizeUrl(source.url) : null;
    const status = source.status ?? "ok";
    return {
      entry_id: entryId,
      url: source.url || null,
      normalized_url: normalized,
      source_type: source.sourceType,
      raw_content: source.rawContent,
      extracted_content: source.extractedContent || null,
      content_metadata: source.contentMetadata || null,
      depth: source.depth,
      status,
      status_reason: source.statusReason ?? null,
      fetch_status_code: source.fetchStatusCode ?? null,
    };
  });

  // Partition rows into "subject to dedup" (status='ok' with a URL) and
  // "always insert" (failed/skipped rows, or rows without a URL). Only
  // the first partition hits the pre-check query.
  const dedupCandidates = allRows.filter(
    (r) => r.status === "ok" && r.normalized_url !== null
  );
  const alwaysInsert = allRows.filter(
    (r) => !(r.status === "ok" && r.normalized_url !== null)
  );

  const toInsert = [...alwaysInsert];

  if (dedupCandidates.length > 0) {
    const candidateUrls = dedupCandidates.map(
      (r) => r.normalized_url as string
    );
    const { data: existing, error: queryError } = await supabase
      .from("sources")
      .select("normalized_url")
      .eq("entry_id", entryId)
      .eq("status", "ok")
      .in("normalized_url", candidateUrls);

    if (queryError) {
      throw new Error(
        `Failed to dedup-check sources: ${queryError.message}`
      );
    }

    const alreadyStored = new Set(
      (existing ?? [])
        .map((r) => (r as { normalized_url: string | null }).normalized_url)
        .filter((u): u is string => typeof u === "string")
    );

    toInsert.push(
      ...dedupCandidates.filter(
        (r) => !alreadyStored.has(r.normalized_url as string)
      )
    );
  }

  if (toInsert.length === 0) return;

  const { error } = await supabase.from("sources").insert(toInsert);

  if (error) {
    // 23505 = unique_violation. A concurrent storeSources call beat us
    // to the punch on at least one URL between our dedup-check query
    // and the insert. Postgres aborts the whole batch on conflict, so
    // without a fallback a single lost race would drop every other
    // non-conflicting row in the same batch too. For single-row
    // batches (current common case) just skip. For multi-row batches
    // retry one-at-a-time so surviving rows still land.
    if ((error as { code?: string }).code === "23505") {
      if (toInsert.length === 1) {
        console.warn(
          `[pipeline] storeSources lost dedup race for entry ${entryId} on single row: ${error.message}`
        );
        return;
      }
      console.warn(
        `[pipeline] storeSources batch 23505 for entry ${entryId}, falling back to one-at-a-time for ${toInsert.length} rows`
      );
      for (const row of toInsert) {
        const { error: singleErr } = await supabase.from("sources").insert(row);
        if (!singleErr) continue;
        const singleCode = (singleErr as { code?: string }).code;
        if (singleCode === "23505") {
          // Expected for the row(s) that lost the race. Skip silently.
          continue;
        }
        // Anything else is a genuine error on a specific row — log
        // and continue so the others still get written, mirroring the
        // legacy tag-insert behavior (non-fatal for search correctness).
        console.error(
          `[pipeline] single-row insert failed for ${row.url ?? "(no url)"}: ${singleErr.message}`
        );
      }
      return;
    }

    // PostgrestError has code / details / hint in addition to message.
    // Surface all four fields so a genuine constraint/type issue is
    // debuggable without re-running the pipeline under a debugger.
    const shapeSummary = toInsert.map((r) => ({
      url: r.url,
      normalized_url: r.normalized_url,
      source_type: r.source_type,
      status: r.status,
      raw_content_len: r.raw_content?.length ?? null,
      extracted_content_len: r.extracted_content?.length ?? null,
      content_metadata_len: r.content_metadata
        ? JSON.stringify(r.content_metadata).length
        : null,
    }));
    console.error(
      `[pipeline] Failed to store ${toInsert.length} source(s) for entry ${entryId}:`,
      {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        rows: shapeSummary,
      }
    );
    const detail = [
      error.code ? `code=${error.code}` : null,
      error.details ? `details=${error.details}` : null,
      error.hint ? `hint=${error.hint}` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const suffix = detail ? ` (${detail})` : "";
    throw new Error(
      `Database write failed for sources: ${error.message}${suffix}`
    );
  }
}

/**
 * Generate a URL-safe slug for an entry.
 *
 * Slugifies the title, then resolves collisions via numeric suffix
 * (`foo`, `foo-2`, `foo-3`, ...). The collision lookup is **prefix-
 * scoped** via `ilike("slug", "${base}%")` so we never pull the entire
 * `entries` table — that pattern already mirrors `generateSkeletonSlug`
 * in features/ingestion/server/skeleton.ts.
 *
 * The unique constraint on `entries.slug` is the final backstop against
 * a concurrent insert that lands the same slug between our prefix
 * lookup and our INSERT. Audit findings S-5 + S-10.
 *
 * Falls back to entry-<short uuid> when the title is empty/missing.
 */
export async function generateEntrySlug(
  entryId: string,
  title: string
): Promise<string> {
  const cleanTitle = title?.trim() ?? "";

  if (!cleanTitle || cleanTitle === "Untitled") {
    // UUID-derived fallback. Collisions only on shared 8-char UUID
    // prefixes (astronomically rare). Prefix-scoped lookup still cheap.
    const fallback = fallbackSlugFromId(entryId);
    const { data: existing } = await supabase
      .from("entries")
      .select("slug")
      .neq("id", entryId)
      .ilike("slug", `${fallback}%`);
    const existingSlugs = (existing || [])
      .map((r) => (r as { slug: string | null }).slug)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (!existingSlugs.includes(fallback)) return fallback;
    return slugifyEntryTitle(fallback, existingSlugs);
  }

  // Compute the base separately from slugifyEntryTitle (which does the
  // same kebab transform internally) so we can prefix-scope the query.
  const base = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "entry";

  const { data: existing } = await supabase
    .from("entries")
    .select("slug")
    .neq("id", entryId)
    .ilike("slug", `${base}%`);

  const existingSlugs = (existing || [])
    .map((r) => (r as { slug: string | null }).slug)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  return slugifyEntryTitle(cleanTitle, existingSlugs);
}
