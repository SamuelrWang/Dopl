# Contributing

This monorepo houses the Dopl Next.js app plus two internal workspace packages (not published to npm):

- [`@dopl/client`](packages/dopl-client) — shared HTTP client.
- [`@dopl/mcp-server`](packages/mcp-server) — the in-process MCP server engine, booted by the app's `/api/mcp` route via `@dopl/mcp-server/factory`.

Users connect to Dopl as a remote, OAuth-authenticated MCP server (`/api/mcp`) — there is no npx/stdio install path and no API keys.

For all conventions — file size cap, naming, error handling, the repository/service split, etc. — read [`docs/ENGINEERING.md`](docs/ENGINEERING.md). When that doc and the existing code disagree, the doc wins.

---

## Getting set up

```sh
git clone https://github.com/SamuelrSun/usedopl.git
cd usedopl
npm install                    # links workspaces
```

Node 18.17+ required. macOS, Linux, and Windows all supported.

## Build order matters

`@dopl/mcp-server` depends on `@dopl/client`. Build the client first:

```sh
npm run build -w @dopl/client
npm run build -w @dopl/mcp-server
```

The CI workflow in `.github/workflows/packages.yml` does this in order on every PR.

## Test

```sh
npm test -w @dopl/client       # vitest
```

Tests live next to source (`foo.ts` → `foo.test.ts` in the same folder), per `docs/ENGINEERING.md` §13.

## Run the MCP server locally

The MCP server is in-process — it boots inside the Next.js app at the `/api/mcp`
route (via `@dopl/mcp-server/factory`). Just run the app:

```sh
npm run dev
```

Then connect any MCP client to `http://localhost:3000/api/mcp` (a browser opens
once to sign in via OAuth). In production the endpoint is
`https://www.usedopl.com/api/mcp`.

## Packages are internal — no npm publishing

`@dopl/client` and `@dopl/mcp-server` are workspace libraries consumed by the app
via npm-workspace symlinks (and `transpilePackages` in `next.config.ts`). They are
marked `private` and are **not published to npm** — there is no release workflow,
no tags, and nothing to re-pin. Edit them in place; the next app build picks up
the changes.

## Conventions cheat sheet

- **Files**: ≤300 lines target / 500 hard cap (CI fails over). Filenames `kebab-case`.
- **Imports**: external → `@/` → relative.
- **No `any`, no `@ts-ignore`.**
- **No comments unless the *why* is non-obvious.**
- **Commits**: `<scope>: <verb> <what>` — e.g., `cli: add packs validate command`. Banned: `fixes`, `wip`, `updates`, `stuff`.
- **One PR = one logical change.** Don't bundle.

See `docs/ENGINEERING.md` for the full set.
