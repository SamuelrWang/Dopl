# @dopl/cli — Changelog

All notable changes to `@dopl/cli` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-24

Initial release. Shell-native companion to `@dopl/mcp-server`. Phase 1 surface: pack browsing + auth.

### Added
- `dopl auth login` — silent (asterisk) password input, validates the key against `/api/user/mcp-status` before saving, `--no-verify` skips the live ping, `--base-url` overrides the API host.
- `dopl auth logout` — clears the saved credentials.
- `dopl auth whoami` — prints status + admin flag; `--json` emits parseable JSON.
- `dopl packs list` — installed knowledge packs as a human table; `--json` for machine output.
- `dopl packs files <pack>` — file listing grouped by category; supports `--category` and `--limit`.
- `dopl packs get <pack> <path>` — markdown body to stdout (pipes cleanly).
- Global `--api-key`, `--base-url`, `--json`, `--verbose` flags (precedence: flag → env → config → default).
- Cross-platform config: `~/.config/dopl/config.json` on macOS/Linux, `%APPDATA%\dopl\config.json` on Windows. Override with `DOPL_CONFIG_PATH`.
- `--verbose` enables the `dopl:*` debug namespace; logs request method, path, status, duration. Never logs the API key.
- Sends `X-Dopl-Client: @dopl/cli@<version>` header for server-side analytics.
- Exit codes: `0` ok, `1` user/4xx, `2` auth, `3` network/5xx, `130` user-aborted prompt.
- `engines.node >=18.17`.

[Unreleased]: https://github.com/SamuelrSun/usedopl/compare/cli-v0.1.0...HEAD
[0.1.0]: https://github.com/SamuelrSun/usedopl/releases/tag/cli-v0.1.0
