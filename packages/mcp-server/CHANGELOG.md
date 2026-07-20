# @dopl/mcp-server — Changelog

All notable changes to `@dopl/mcp-server` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed — BREAKING: fail-closed workspace targeting (MCP-2)

The server no longer picks a "default" workspace when the caller belongs to
2+ workspaces. Workspace targeting is now explicit and fail-closed.

- **Boot resolves off the membership directory.** Boot calls
  `client.listWorkspaces()` (replacing the `getActiveWorkspace` handshake).
  Exactly one membership auto-targets it; a request-level `X-Workspace-Id`
  pin that names a membership is honored; **2+ memberships and no pin leave
  NO session default**.
- **No-default calls are refused, not guessed.** With no session default, a
  tool call that omits `workspace=` returns an `isError` response listing the
  caller's workspaces and demanding `workspace=<slug_or_id>`. Single-workspace
  (and pinned) sessions are unaffected — `workspace=` stays optional there.
- **`buildInstructions(directory)`** bakes the caller's workspace table
  (name/slug/role/description) and the targeting rule into the server
  instructions, so the agent knows before its first call whether it must pass
  `workspace=`.
- **`_dopl_status` footer is mandatory-effective.** Every successful response
  names the workspace it actually hit plus a source label: `per-call arg`,
  `sole membership`, or `header pin`.
- **Removed `set_workspace`.** A stateless HTTP connection can't persist a
  switch, so the tool was misleading. Use the per-call `workspace=` arg.
  `current_workspace` now reports which workspace a no-arg call resolves to
  (or, for 2+ memberships, lists the choices). `list_workspaces` is unchanged
  except its copy (★ = the auto-target, or "pass `workspace=`" when 2+).
- Backend `resolveActiveWorkspace` is fail-closed to match: header UUID only
  (blank/non-UUID → 400 `WORKSPACE_INVALID`), no-header → active memberships
  (0/2+ → 400 `WORKSPACE_REQUIRED`). No default-workspace fallback.
- **A pinned 2+-membership connection is told the pin IS its default** — instructions and `current_workspace` say a no-arg call targets the pinned workspace instead of demanding `workspace=` on every call.
- **Transient directory-load failures now read differently from zero memberships** — when boot's `listWorkspaces()` fails, the instructions and no-workspace refusal say "couldn't load your workspaces — retry" rather than "you're not a member of any workspace".

Requires the co-versioned app backend (this repo) — the loopback `/api/*`
routes now fail closed on ambiguous targeting.

## [1.1.0] — 2026-06-04

### Removed — cluster "brain" feature

The cluster brain (synthesized instructions + memories) was removed from
Dopl. Clusters are now pure groupings of entries.

- Dropped the `dopl_brain` tool (`op=get|update_instructions|save_memory|update_memory|template`).
- Dropped `dopl_cluster_admin(op=delete_memory)`.
- Removed brain-synthesis guidance from `SERVER_INSTRUCTIONS`, the bundled
  `skills/dopl/SKILL.md`, and `HOOKS.md`.
- Requires `@dopl/client` ≥ 0.13.0 (brain client methods removed there).

## [1.0.0] — 2026-06-03

### Changed — BREAKING: tool consolidation (~77 → 18)

The tool surface was collapsed from ~77 individual tools into 18 — five
standalone tools plus ten domain "action" tools (and three destructive
`*_admin` companions) that dispatch on an `op` argument. This cuts
per-tool permission prompts, shrinks the context the tool list consumes,
and removes near-duplicate names. **Any MCP client re-reads the tool list
on reconnect, so no code change is needed — but pinned tool-name
allowlists, saved automations, or skills that reference the old names must
be updated.** The companion fix for permission fatigue is to allowlist the
whole server once: `"permissions": { "allow": ["mcp__dopl"] }` in
`~/.claude/settings.json`.

**Standalone (unchanged):** `search_setups`, `build_solution`,
`list_workspaces`, `set_workspace`, `current_workspace`.

**Old tool → new call:**

- `list_setups` / `get_setup` → `dopl_setups(op="list"|"get")`
- `list_clusters` / `get_cluster` / `query_cluster` / `canvas_create_cluster` /
  `update_cluster` / `rename_cluster` / `add_entry_to_cluster` /
  `read_cluster_knowledge_entry` / `read_cluster_skill` →
  `dopl_cluster(op="list"|"get"|"query"|"create"|"update"|"add_entry"|"read_knowledge_entry"|"read_skill")`
  (`rename_cluster` folded into `op="update"` and removed)
- `delete_cluster` / `delete_cluster_memory` / `delete_entry` →
  `dopl_cluster_admin(op="delete_cluster"|"delete_memory"|"delete_entry")`
- `get_cluster_brain` / `update_cluster_brain` / `save_cluster_memory` /
  `update_cluster_memory` / `get_skill_template` →
  `dopl_brain(op="get"|"update_instructions"|"save_memory"|"update_memory"|"template")`
- `canvas_list_panels` / `canvas_add_entry` / `canvas_remove_entry` /
  `canvas_search_and_add` / `rename_chat` →
  `dopl_canvas(op="list"|"add_entry"|"remove_entry"|"search_and_add"|"rename_chat")`
- `update_entry` / `check_entry_updates` / `check_cluster_updates` →
  `dopl_entry(op="update"|"check_updates"|"check_cluster_updates")`
- `ingest_url` / `get_ingest_content` / `describe_link` / `list_pending_ingests` /
  `submit_ingested_entry` / `skeleton_ingest` (admin) →
  `dopl_ingest(op="url"|"content"|"describe_link"|"pending"|"submit"|"skeleton")`
- `kb_list_packs` / `kb_list` / `kb_get` →
  `dopl_packs(op="list"|"list_files"|"get_file")`
- the 15 non-destructive `kb_*` (user bases) → `dopl_kb(op=…)`;
  `kb_delete_base|folder|file` → `dopl_kb_admin(op="delete_base"|"delete_folder"|"delete_file")`
- the 10 non-destructive `skill_*` → `dopl_skill(op=…)`;
  `skill_delete` / `skill_delete_file` → `dopl_skill_admin(op="delete"|"delete_file")`
- the 8 integration tools → `dopl_integration(op="connect"|"status"|"list_my"|"list_objects"|"read_object"|"list_actions"|"execute_action"|"ingest")`

### Removed
- `rename_cluster` — redundant with `dopl_cluster(op="update", name=…)`.

### Internal
- Split the ~2,000-line `server.ts` into per-domain modules under
  `src/tools/` (closes tracked debt #20). Each domain tool's `op` bodies
  are the prior handlers, lifted unchanged; behavior is preserved.

## [0.8.0] — 2026-05-01

### Added
- 17 user-knowledge-base tools wrapping the new `kb_*` surface in the
  Dopl API. The agent talks to a base like a filesystem: `kb_list_bases`,
  `kb_get_tree`, `kb_create_base`, `kb_update_base`, `kb_delete_base`,
  `kb_restore_base`, `kb_list_dir`, `kb_create_folder`, `kb_delete_folder`,
  `kb_move_folder`, `kb_read_file`, `kb_write_file`, `kb_delete_file`,
  `kb_move_file`, `kb_list_trash`, `kb_restore_folder`, `kb_restore_file`,
  `kb_search`. Bases addressed by slug or UUID; folders/entries by
  `/`-separated path. Distinct from the existing read-only
  `kb_list_packs` / `kb_list` / `kb_get` tools (Dopl-curated specialist
  packs).

### Changed
- Bumped `@dopl/client` peer to `^0.3.0` for the new knowledge surface
  and the `createKbFolderByPath` shape fix (now returns
  `KnowledgeFolder` directly).

## [0.7.1] — 2026-04-30

### Fixed
- `package.json` dependency range corrected to `"@dopl/client": "^0.2.0"`.
  0.7.0 was published with the stale `^0.1.0` range, which would fail
  to install because `@dopl/client@0.1.0` is not on the registry. No
  code changes — same dist as 0.7.0.

## [0.7.0] — 2026-04-30

### Added
- Canvas (workspace) selection. The server reads `--workspace-id <uuid>` /
  `DOPL_WORKSPACE_ID` env var / `~/.config/dopl/config.json`'s `canvasId`
  in that order, hand-shakes against `/api/workspaces/me` on startup,
  and stamps every API call with `X-Canvas-Id`. A session is now
  bound to one canvas at a time.
- `save_cluster_memory` accepts an optional `scope` arg
  (`workspace` | `personal`). Personal memories are visible only to
  the author and are tagged `_(personal)_` inline in the SKILL.md.
- Per-canvas skill paths: `~/.claude/skills/dopl-<workspaceSlug>-<clusterSlug>/`
  for non-default canvases. The default canvas keeps the legacy
  `dopl-<clusterSlug>/` path so existing single-canvas users see no
  file renames on first sync after upgrade.
- `.dopl-meta.json` per skill directory recording `{ version,
  syncedAt, entrySlugs }`. `sync_skills` now skips re-writes when the
  on-disk version matches the server's `brain_version` — replaces the
  legacy "if SKILL.md exists, skip" heuristic that silently missed
  every server-side brain edit.
- Atomic file writes (temp file + rename) for SKILL.md, references,
  and CLAUDE.md so a crash mid-sync never leaves a torn skill.
- File-lock around the `~/.claude/CLAUDE.md` read-modify-write cycle
  so parallel `sync_skills` calls don't clobber each other.
- Per-canvas sentinel markers in `CLAUDE.md`
  (`<!-- DOPL:START:slug -->` / `<!-- DOPL:END:slug -->`) so each
  canvas owns its own block.
- Orphan-reference reconciliation: entries removed from a cluster
  since the last sync get their `references/<slug>.md` unlinked on
  the next `sync_skills` call.

### Changed
- `BrainData` returned by `getClusterBrain` now includes
  `brain_version` (monotonic, bumped server-side via Postgres trigger
  on `instructions` change). Memories carry an optional `scope` and
  `is_mine` field.

## [0.6.2] — 2026-04-24

### Changed
- HTTP client extracted to `@dopl/client@^0.1.0`. No tool surface changes; identical behavior. Reduces duplication with the upcoming `@dopl/cli`.

### Added
- Sends `X-Dopl-Client: @dopl/mcp-server@<version>` header on every request — used for server-side adoption analytics.
- Inherits `@dopl/client`'s retry behavior (jittered backoff for idempotent methods, `Retry-After` honored on 429).
- Inherits structured error parsing from `@dopl/client` — server `{ error: { code, message } }` shapes surface in error messages.
- `engines.node >=18.17`.

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/mcp-server-v0.8.0...HEAD
[0.8.0]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.8.0
[0.7.1]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.7.1
[0.7.0]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.7.0
[0.6.2]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.6.2
