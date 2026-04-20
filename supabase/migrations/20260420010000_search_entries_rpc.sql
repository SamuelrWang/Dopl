-- Pin `search_entries` in source control and consolidate two dashboard
-- overloads down to one.
--
-- Pre-migration state (as dumped from prod via pg_get_functiondef):
--   Overload A — 6 args, no filter_entry_ids, NO moderation_status filter.
--     Dead code: the current client (src/lib/retrieval/search.ts) always
--     passes filter_entry_ids, so named-arg resolution never routes here.
--     But it's still callable and would leak unmoderated entries if
--     anything ever hits it.
--   Overload B — 7 args, filter_entry_ids present, moderation_status =
--     'approved' enforced. This is the one currently in use.
--
-- Changes in this migration:
--   1. Drop both overloads so only the pinned version exists.
--   2. New signature adds one extra optional param: `caller_user_id uuid`.
--      The moderation predicate becomes
--        (moderation_status = 'approved' OR ingested_by = caller_user_id)
--      so an owner's own pending/rejected entries appear in their search
--      results without leaking them to everyone else. Passing NULL (or
--      omitting the arg) gives strict approved-only behavior, preserving
--      backwards compatibility for unauthenticated callers.
--   3. Tightens the moderation predicate to also count NULL as non-approved
--      (defense in depth — any future status value is implicitly denied
--      unless it's explicitly 'approved').

DROP FUNCTION IF EXISTS public.search_entries(
  vector, double precision, integer, text[], text, text
);

DROP FUNCTION IF EXISTS public.search_entries(
  vector, double precision, integer, text[], text, text, uuid[]
);

CREATE OR REPLACE FUNCTION public.search_entries(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.4,
  match_count integer DEFAULT 10,
  filter_tags text[] DEFAULT NULL,
  filter_use_case text DEFAULT NULL,
  filter_complexity text DEFAULT NULL,
  filter_entry_ids uuid[] DEFAULT NULL,
  caller_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  entry_id uuid,
  title text,
  summary text,
  use_case text,
  complexity text,
  readme text,
  agents_md text,
  manifest jsonb,
  similarity double precision
)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    sub.entry_id,
    sub.title,
    sub.summary,
    sub.use_case,
    sub.complexity,
    sub.readme,
    sub.agents_md,
    sub.manifest,
    sub.similarity
  FROM (
    SELECT DISTINCT ON (e.id)
      e.id AS entry_id,
      e.title,
      e.summary,
      e.use_case,
      e.complexity,
      e.readme,
      e.agents_md,
      e.manifest,
      (1 - (c.embedding <=> query_embedding))::FLOAT AS similarity
    FROM chunks c
    JOIN entries e ON e.id = c.entry_id
    LEFT JOIN tags t ON t.entry_id = e.id
    WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
      AND e.status = 'complete'
      AND (
        e.moderation_status = 'approved'
        OR (caller_user_id IS NOT NULL AND e.ingested_by = caller_user_id)
      )
      AND (filter_use_case IS NULL OR e.use_case = filter_use_case)
      AND (filter_complexity IS NULL OR e.complexity = filter_complexity)
      AND (filter_tags IS NULL OR t.tag_value = ANY(filter_tags))
      AND (filter_entry_ids IS NULL OR e.id = ANY(filter_entry_ids))
    ORDER BY e.id, similarity DESC
  ) sub
  ORDER BY sub.similarity DESC
  LIMIT match_count;
END;
$function$;
