# @dopl/client — Changelog

All notable changes to `@dopl/client` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] — 2026-05-01

### Added
- User knowledge bases — 17 surface methods on `DoplClient` covering
  bases (`listKbBases`, `getKbBase`, `getKbTree`, `createKbBase`,
  `updateKbBase`, `deleteKbBase`, `restoreKbBase`), path-based file/folder
  ops (`readKbFileByPath`, `writeKbFileByPath`, `listKbDirByPath`,
  `createKbFolderByPath`, `deleteKbByPath`, `moveKbByPath`), trash
  (`listKbTrash`, `restoreKbFolder`, `restoreKbEntry`), and full-text
  search (`searchKb`).
- New types in `knowledge-types.ts`: `KnowledgeBase`, `KnowledgeFolder`,
  `KnowledgeEntry`, `KnowledgeEntryType`, `KnowledgeWriteSource`,
  `KnowledgeTreeSnapshot`, `KnowledgeDirListing`, `KnowledgeTrashSnapshot`,
  `KnowledgeBaseCreateInput`, `KnowledgeBaseUpdateInput`,
  `KnowledgeWriteFileInput`, `KnowledgePathOpResult`, `KnowledgeSearchHit`.

### Changed (breaking)
- `createKbFolderByPath` now returns `Promise<KnowledgeFolder>` directly
  instead of the wrapping `Promise<{ folder: KnowledgeFolder }>` envelope.
  Aligns with every other unwrapping method (`getKbBase`, `restoreKbFolder`,
  etc.). Callers were either destructuring `{folder}` immediately or were
  broken; update to use the result directly.

## [0.2.0] — 2026-04-30

### Added
- Canvas (workspace) selection on the transport. New
  `DoplClientOptions.canvasId` and `DoplClient.setWorkspaceId(id)` /
  `getWorkspaceId()`. When set, every request emits an `X-Canvas-Id`
  header so the server scopes data to that canvas. When unset, the
  server falls back to the user's default canvas.
- `client.listWorkspaces()` — list every canvas the caller is an active
  member of.
- `client.getWorkspace(slug)` — fetch one canvas + caller's role.
- `client.getActiveWorkspace()` — resolve the canvas this transport is
  currently scoped to (used by the MCP server's startup handshake).
- `client.saveClusterMemory(slug, content, scope?)` — the optional
  `scope` arg (`workspace` | `personal`) routes the write through the
  new server-side scope/visibility filter.
- `BrainData.brain_version` (number, optional) returned by
  `getClusterBrain` — monotonic counter the server bumps on every
  `instructions` change.
- `BrainMemory.scope` and `BrainMemory.is_mine` carried through on
  every memory returned by `getClusterBrain`.
- New types: `WorkspaceSummary`, `WorkspaceRole`, `ResolvedWorkspace`,
  `MemoryScope`.

### Changed
- `getClusterBrain` return type is now richer (includes
  `brain_version` and per-memory scope/is_mine).

## [0.1.0] — 2026-04-24

Initial extraction from `@dopl/mcp-server`. Shared HTTP client consumed by `@dopl/mcp-server` and `@dopl/cli`.

### Added
- `DoplClient` — typed HTTP client for the Dopl API with progressive disclosure across packs, clusters, canvas, ingest, and entries.
- `DoplTransport` — internal transport layer with retries (jittered exponential backoff for idempotent methods, `Retry-After` honored on 429) and structured error propagation.
- Typed errors: `DoplApiError` (with parsed `code`/`apiMessage`/`details` from canonical `{ error: { code, message, details } }` shape), `DoplAuthError`, `DoplNetworkError`, `DoplTimeoutError`.
- `parseRetryAfter` exported for callers that want the same parsing behavior.
- `clientIdentifier` option on `DoplClientOptions`. When set, the client sends `X-Dopl-Client: <identifier>` (e.g., `@dopl/cli@0.1.0`) on every request — used for server-side adoption analytics.
- `debug` namespace `dopl:client` — logs method, path, status, duration, and retry count. No secrets or response bodies.
- `engines.node >=18.17` (Node 18+ ships stable `fetch`).

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/client-v0.3.0...HEAD
[0.3.0]: https://github.com/SamuelrSun/usedopl/releases/tag/client-v0.3.0
[0.2.0]: https://github.com/SamuelrSun/usedopl/releases/tag/client-v0.2.0
[0.1.0]: https://github.com/SamuelrSun/usedopl/releases/tag/client-v0.1.0
