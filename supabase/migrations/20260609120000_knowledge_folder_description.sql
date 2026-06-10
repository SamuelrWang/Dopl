-- Folder descriptions — short agent-facing summaries of folder contents.
-- Edited from the KB settings modal; streamed to MCP clients in
-- dopl_kb get_tree / list_dir so agents can navigate without opening
-- every file. Entries reuse the existing `excerpt` column for the same
-- purpose; knowledge_bases already have `description`.
-- Length is capped at 300 chars by the Zod schemas at the API boundary.

alter table public.knowledge_folders
  add column if not exists description text;

comment on column public.knowledge_folders.description is
  'Agent-facing summary of folder contents (API caps at 300 chars; surfaced via MCP get_tree/list_dir).';
