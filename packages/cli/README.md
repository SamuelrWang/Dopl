# @dopl/cli

Shell-native companion to the Dopl knowledge base. Read-only Phase 1: browse installed knowledge packs, fetch file bodies, and manage CLI credentials.

## Install (local workspace)

```sh
npm install            # from repo root — links workspaces
npm run build -w @dopl/client
npm run build -w @dopl/cli

# Run the binary directly
./packages/cli/dist/bin/dopl.js --help

# Or make it available as `dopl` on your PATH
npm link -w @dopl/cli
```

## Auth

```sh
dopl auth login                 # prompt for an sk-dopl-* key, save to ~/.config/dopl/config.json
dopl auth whoami                # ping the API with the saved key
dopl auth logout                # forget the saved key
```

Alternative sources (first match wins):

1. `--api-key <key>` flag
2. `DOPL_API_KEY` env var
3. `~/.config/dopl/config.json`

Same for base URL: `--base-url <url>` → `DOPL_BASE_URL` → config → default `https://www.usedopl.com`.

## Packs

```sh
dopl packs list                        # installed packs
dopl packs list --json

dopl packs files <pack>                # list files in a pack (metadata only)
dopl packs files <pack> --category sdk

dopl packs get <pack> <path>           # markdown body to stdout
dopl packs get rokid docs/sdk/camera.md > camera.md
```

`--json` is honored on every command for machine-readable output.

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | ok |
| 1    | user error / 4xx (bad args, unknown pack) |
| 2    | auth failure (missing key, 401, 403) |
| 3    | network error / 5xx |
