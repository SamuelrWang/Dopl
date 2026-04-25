# @dopl/mcp-server — Changelog

All notable changes to `@dopl/mcp-server` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.2] — 2026-04-24

### Changed
- HTTP client extracted to `@dopl/client@^0.1.0`. No tool surface changes; identical behavior. Reduces duplication with the upcoming `@dopl/cli`.

### Added
- Sends `X-Dopl-Client: @dopl/mcp-server@<version>` header on every request — used for server-side adoption analytics.
- Inherits `@dopl/client`'s retry behavior (jittered backoff for idempotent methods, `Retry-After` honored on 429).
- Inherits structured error parsing from `@dopl/client` — server `{ error: { code, message } }` shapes surface in error messages.
- `engines.node >=18.17`.

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/mcp-server-v0.6.2...HEAD
[0.6.2]: https://github.com/SamuelrSun/usedopl/releases/tag/mcp-server-v0.6.2
