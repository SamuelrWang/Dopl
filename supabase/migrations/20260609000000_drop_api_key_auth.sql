-- Drop the npx/stdio + API-key install path's database objects.
--
-- API-key authentication was removed in favor of the remote, OAuth-
-- authenticated MCP server (/api/mcp). The `api_keys` + `api_key_usage`
-- tables and the per-key `check_and_record_rate_limit` RPC are no longer
-- referenced by any application code. Their RLS policies and indexes drop
-- with the tables.
--
-- DELIBERATELY KEPT (the OAuth path still uses them):
--   - `rate_limit_events` table + `check_and_record_rate_limit_subject(text,int,text)` RPC
--   - `profiles.mcp_connected_at` (the "MCP connected" indicator timestamp)
--
-- Reinstatement: ~/Desktop/dopl-artifacts/mcp-npx-apikey-install/schema/reinstate.sql

drop function if exists public.check_and_record_rate_limit(uuid, integer, text);

-- api_key_usage FKs to api_keys (ON DELETE CASCADE); drop the child first.
drop table if exists public.api_key_usage;

-- `mcp_events.api_key_id` also FKs to api_keys (ON DELETE SET NULL), so a plain
-- DROP TABLE would be refused. CASCADE drops that dependent FK constraint while
-- leaving the `mcp_events` table + its (now plain, nullable) api_key_id column —
-- and the historical analytics rows — intact.
drop table if exists public.api_keys cascade;
