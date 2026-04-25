# @dopl/cli

The shell-native companion to the Dopl knowledge base. Browse installed knowledge packs, fetch markdown bodies, and manage CLI credentials — all from your terminal, agent, or CI script.

```sh
npm install -g @dopl/cli
dopl auth login
dopl packs list
dopl packs get rokid docs/sdk/camera.md > camera.md
```

---

## Install

### As a published binary

```sh
npm install -g @dopl/cli
```

Requires Node 18.17+. Works on macOS, Linux, and Windows.

### From the monorepo (development)

```sh
git clone https://github.com/SamuelrSun/usedopl.git
cd usedopl
npm install              # links workspaces
npm run build -w @dopl/client
npm run build -w @dopl/cli

# either run directly:
./packages/cli/dist/bin/dopl.js --help

# …or expose `dopl` on your PATH:
npm link -w @dopl/cli
```

---

## Auth

The CLI needs a `sk-dopl-…` API key. Sources, in precedence order:

1. `--api-key <key>` flag
2. `DOPL_API_KEY` env var
3. `~/.config/dopl/config.json` (macOS / Linux) — `%APPDATA%\dopl\config.json` on Windows. Override with `DOPL_CONFIG_PATH`.

```sh
dopl auth login                 # prompts (asterisks); validates the key against /mcp-status before saving
dopl auth login --no-verify     # skip the live ping (useful behind a corporate proxy)
dopl auth whoami                # prints status + admin flag
dopl auth whoami --json         # parseable JSON
dopl auth logout                # forget the saved key
```

Same precedence applies to `--base-url` / `DOPL_BASE_URL` / config — defaults to `https://www.usedopl.com`.

---

## Packs

```sh
dopl packs list                                # installed packs as a table
dopl packs list --json                         # JSON

dopl packs files <pack>                        # list files (metadata only)
dopl packs files rokid --category sdk          # restrict to /docs/sdk/

dopl packs get <pack> <path>                   # markdown body to stdout (pipes cleanly)
dopl packs get rokid docs/sdk/camera.md > camera.md
```

The flow is **progressive disclosure** — `list` to discover packs, `files` to browse one, `get` to drill in. `--json` is honored on every command for machine output.

---

## Using `dopl` from an agent

Pair the CLI with a Claude Code skill so the agent reaches for the right pack automatically:

```md
---
name: rokid-ar
description: Use when the user mentions Rokid AR glasses, YodaOS, or AR SDK calls
---

To answer Rokid-related questions, run:

    dopl packs files rokid

…then drill into the relevant doc with:

    dopl packs get rokid <path>

Cite the file path so the user can verify against the public repo.
```

The agent uses bash directly — no MCP server required.

---

## Global flags

```
--api-key <key>          override env + config
--base-url <url>         override env + config
--json                   machine-parseable output
--verbose                stream `dopl:*` debug logs to stderr
--no-update-notifier     skip the once-per-day npm update check
-V, --version            print version
-h, --help               print help (also per command)
```

Suppress the update notifier permanently with `NO_UPDATE_NOTIFIER=1`.

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | ok |
| 1    | user error / 4xx (bad args, unknown pack, etc.) |
| 2    | auth failure (missing key, 401, 403) |
| 3    | network error / 5xx |
| 130  | aborted at the prompt (Ctrl-C) |

---

## Troubleshooting

### `No Dopl API key found.`
You haven't run `dopl auth login`, and `DOPL_API_KEY` isn't set. Either log in or pass `--api-key`.

### `Authentication failed (401).`
The saved key is invalid or revoked. Re-run `dopl auth login` and paste a fresh key.

### `Server error (5xx)`
The backend is having a moment. The CLI already retries 502/503/504/429 with backoff; if you still see this, it's a real outage. Re-run with `--verbose` to see what attempt failed.

### Verbose debug output
```sh
dopl --verbose packs list
# 2026-04-24T... dopl:cli command=list verbose=yes json=no
# 2026-04-24T... dopl:client GET /api/knowledge/packs → 200 in 142ms
```

The API key is **never** logged. Safe to paste verbose output into bug reports.

---

## License

MIT. See [CHANGELOG.md](./CHANGELOG.md) for release history.
