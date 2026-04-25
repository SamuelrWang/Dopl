# @dopl/client — Changelog

All notable changes to `@dopl/client` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/client-v0.1.0...HEAD
[0.1.0]: https://github.com/SamuelrSun/usedopl/releases/tag/client-v0.1.0
