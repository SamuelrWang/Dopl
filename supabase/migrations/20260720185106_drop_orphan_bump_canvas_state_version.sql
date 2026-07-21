-- Drop the orphan public.bump_canvas_state_version() function (obsolete cleanup).
--
-- Left over from the removed Canvas feature (its tables were dropped in
-- 20260717073238_drop_canvas_tables). Verified against prod: the function is
-- attached to no trigger and has no non-auto dependents, and it exists in no
-- migration. Remove it. IF EXISTS keeps this a safe no-op if it was already
-- cleared. Purely subtractive, no data change, no lock risk.

DROP FUNCTION IF EXISTS public.bump_canvas_state_version();
