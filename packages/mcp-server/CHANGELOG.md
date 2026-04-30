# @dopl/mcp-server — Changelog

All notable changes to `@dopl/mcp-server` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/mcp-server-v0.7.1...HEAD
[0.7.1]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.7.1
[0.7.0]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.7.0
[0.6.2]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.6.2
