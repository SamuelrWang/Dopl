-- Pin search_path on the cluster-attachment trigger functions so a
-- malicious schema can't hijack name resolution. Mirrors what the
-- Supabase advisors recommend for SECURITY DEFINER and trigger
-- functions. No behavior change — the bodies already qualify their
-- table references implicitly via the public schema.

ALTER FUNCTION public.assert_cluster_kb_workspace() SET search_path = public, pg_temp;
ALTER FUNCTION public.assert_cluster_skill_workspace() SET search_path = public, pg_temp;
ALTER FUNCTION public.cascade_kb_soft_delete_to_attachments() SET search_path = public, pg_temp;
ALTER FUNCTION public.cascade_skill_soft_delete_to_attachments() SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_canvas_panels_on_kb_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.cleanup_canvas_panels_on_skill_delete() SET search_path = public, pg_temp;
