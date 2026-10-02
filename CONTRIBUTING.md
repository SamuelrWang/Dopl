# Contributing

## Layout

The repo is an npm-workspaces monorepo (`apps/*`, `packages/*`) around the Next.js
app in `src/`, plus the Electron app in `dopl-desktop-app/`:

- `src/` — the Next.js app: API routes, server features, the web pages, and `/api/mcp`.
- [`apps/desktop-ui`](apps/desktop-ui) (`@dopl/desktop-ui`) — the bundled SPA the desktop app loads.
- [`packages/dopl-client`](packages/dopl-client) (`@dopl/client`) — typed HTTP client.
- [`packages/mcp-server`](packages/mcp-server) (`@dopl/mcp-server`) — the MCP server, booted
  in-process by the app's `/api/mcp` route via `@dopl/mcp-server/factory`.
- [`packages/contracts`](packages/contracts) (`@dopl/contracts`) — shared wire types.
- `dopl-desktop-app/` — the Electron main process. A **separate** npm project (own
  `package.json` and lockfile), not a workspace.

All packages are `private`; nothing is published to npm. Users connect to Dopl as a
remote, OAuth-authenticated MCP server (`/api/mcp`) — there is no stdio install path
and no API keys.

## Which doc wins

Read [CLAUDE.md](CLAUDE.md) first. Precedence is **code > [docs/INVARIANTS.md](docs/INVARIANTS.md)
> [docs/ENGINEERING.md](docs/ENGINEERING.md)**. INVARIANTS is the standing statement of how the
system behaves; ENGINEERING is the rationale and history. UI work starts at
[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md). Findings live in
[docs/REFACTOR-FINDINGS.md](docs/REFACTOR-FINDINGS.md).

## Setup

macOS only (Dopl ships one platform). Node 22, as CI runs.

```sh
git clone https://github.com/SamuelrWang/Dopl.git
cd Dopl
npm install                              # root + workspaces
(cd dopl-desktop-app && npm install)     # the desktop project
cp .env.example .env.local               # then fill it in
```

## Run

```sh
npm run dev                              # web app + /api/mcp on http://localhost:3000
npm run dev:ui                           # SPA dev server on http://localhost:5173
cd dopl-desktop-app && DOPL_APP_URL=http://localhost:3000 npm run dev
```

`npm run dev` in `dopl-desktop-app` sets `DOPL_UI_DEV_URL=http://localhost:5173`;
`DOPL_APP_URL` points the desktop at the local API (default: production).
Details: [dopl-desktop-app/WIRING.md](dopl-desktop-app/WIRING.md).

## Packages load from their committed `dist/`

`next.config.ts › serverExternalPackages` keeps `@dopl/client` and `@dopl/mcp-server`
external, so the app loads their **committed `dist/`**. After editing a package's `src/`:

```sh
npm run build:packages     # builds @dopl/client, then @dopl/mcp-server (order matters)
```

and commit the `dist/` changes. CI fails if `dist/` is not the build of `src/`.

## Test and gates

See [TESTING.md](TESTING.md). "Done" means green on everything in CLAUDE.md
("Definition of green") and docs/INVARIANTS.md §14 — five suites, two lints, two
typechecks and the non-suite gates. Re-derive the list from
`grep -n 'run:' .github/workflows/ci.yml`.

## Conventions (summary)

- 500-line hard cap per file (eslint `max-lines`; CI size-check over `packages/`).
- Filenames `kebab-case`; tests next to the code (`foo.ts` → `foo.test.ts`).
- No `any`, no `@ts-ignore`.
- Commits: `<type>(<scope>): <what>` or `<scope>: <what>` — e.g. `fix(mcp): …`, `channels: …`.
  One commit, one logical change.
- Docs: a number carries its measurement date; code references use `path › symbol`,
  never a line number (CLAUDE.md, "Standing rules for writing docs").
