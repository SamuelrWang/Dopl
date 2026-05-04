// Default Supabase env vars for tests that import server-only modules.
// Real DB hits aren't expected — services take a `db` dep that tests
// inject; these vars exist solely so `supabaseAdmin()`'s module-load
// guard passes. Individual tests override per-test envs (e.g.
// `INTEGRATIONS_NOTION_AUTH_CONFIG_ID`) via `vi.stubEnv`.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
