# Contributing

This monorepo houses the Dopl Next.js app plus three published packages:

- [`@dopl/client`](packages/dopl-client) — shared HTTP client.
- [`@dopl/cli`](packages/cli) — the `dopl` shell binary.
- [`@dopl/mcp-server`](packages/mcp-server) — the MCP server.

The Next.js app uses these packages indirectly (the API the packages talk to lives in `src/app/api`).

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

`@dopl/cli` and `@dopl/mcp-server` both depend on `@dopl/client`. Build the client first:

```sh
npm run build -w @dopl/client
npm run build -w @dopl/mcp-server
npm run build -w @dopl/cli
```

The CI workflow in `.github/workflows/packages.yml` does this in order on every PR.

## Test

```sh
npm test -w @dopl/client       # vitest, 33+ tests
npm test -w @dopl/cli          # vitest, 49+ tests
```

CLI tests use `vi.fn()`-stubbed `global.fetch` rather than `msw` for speed. Tests live next to source (`foo.ts` → `foo.test.ts` in the same folder), per `docs/ENGINEERING.md` §13.

## Run the CLI against a local dev server

```sh
# Start the Next.js dev server in one terminal:
npm run dev

# In another terminal:
export DOPL_BASE_URL=http://localhost:3000
export DOPL_API_KEY=sk-dopl-...      # one of your dev keys
./packages/cli/dist/bin/dopl.js packs list
```

Or `npm link -w @dopl/cli` to expose `dopl` globally on your machine.

## Run the MCP server locally

```sh
node packages/mcp-server/dist/bin/dopl-mcp.js --api-key sk-dopl-... --base-url http://localhost:3000
```

It speaks stdio. Wire it into your Claude Code or other MCP-compatible agent the same way you would a published `@dopl/mcp-server`.

## Releasing a package

1. Update the package's `CHANGELOG.md` — move entries from `[Unreleased]` to a new versioned section.
2. Bump the version in the package's `package.json` (semver).
3. If publishing `@dopl/client`, bump the `^X.Y.Z` range in `@dopl/cli` and `@dopl/mcp-server`'s `dependencies` if the new version is a breaking change.
4. Commit on `master`.
5. Tag in the form `<package>-v<version>`:
   ```sh
   git tag client-v0.1.0      # publishes @dopl/client
   git tag cli-v0.1.0         # publishes @dopl/cli
   git tag mcp-server-v0.6.2  # publishes @dopl/mcp-server
   git push origin --tags
   ```
6. The `release.yml` workflow runs build + test, publishes the matching workspace to npm, then creates a GitHub release with the CHANGELOG body.

If `@dopl/client` and `@dopl/cli` both have new versions, **publish the client first**, then bump and publish the CLI. npm resolves `^X.Y.Z` against the registry at install time, not the workspace.

## Conventions cheat sheet

- **Files**: ≤300 lines target / 500 hard cap (CI fails over). Filenames `kebab-case`.
- **Imports**: external → `@/` → relative.
- **No `any`, no `@ts-ignore`.**
- **No comments unless the *why* is non-obvious.**
- **Commits**: `<scope>: <verb> <what>` — e.g., `cli: add packs validate command`. Banned: `fixes`, `wip`, `updates`, `stuff`.
- **One PR = one logical change.** Don't bundle.

See `docs/ENGINEERING.md` for the full set.
