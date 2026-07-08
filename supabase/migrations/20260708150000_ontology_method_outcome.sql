-- Ontology actions: `requires` (attribute paths the action pulls) is
-- replaced by `outcome` (what the result of the action should be).
-- Fold any existing requires paths into outcome so typed data survives.
UPDATE ontology_objects
SET methods = COALESCE(
  (
    SELECT jsonb_agg(
      (m - 'requires') || jsonb_build_object(
        'outcome',
        COALESCE(
          NULLIF(m->>'outcome', ''),
          NULLIF(
            (
              SELECT string_agg(v, ', ')
              FROM jsonb_array_elements_text(COALESCE(m->'requires', '[]'::jsonb)) AS v
            ),
            ''
          ),
          ''
        )
      )
    )
    FROM jsonb_array_elements(methods) AS m
  ),
  '[]'::jsonb
)
WHERE methods IS NOT NULL AND methods <> '[]'::jsonb;
