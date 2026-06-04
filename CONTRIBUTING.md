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

Each package (`@dopl/client`, `@dopl/cli`, `@dopl/mcp-server`) versions and
publishes independently. There are two publish paths — **CI** (hands-off, the
default) and **local** (fallback when CI lacks an npm token). Both share the
same prep.

### 1. Prep (always)

1. Move the `[Unreleased]` notes in the package's `CHANGELOG.md` into a new
   `## [X.Y.Z] — YYYY-MM-DD` section. (The release job extracts this section for
   the GitHub release body and **fails if it's empty**.)
2. Bump `version` in the package's `package.json` (semver). Note: `0.x → 1.0.0`
   is a *forward* major bump — semver compares **major first**, so `1.0.0` is
   newer than `0.18.1`, not older. In `0.x`, the **minor** is the breaking slot
   (`0.18.1 → 0.19.0`) if you want to stay pre-1.0.
3. **Sync the lockfile** — the release job runs `npm ci`, which fails if
   `package-lock.json` doesn't match the bumped version:
   ```sh
   npm install --package-lock-only
   ```
4. If publishing `@dopl/client` with breaking changes, bump the `^X.Y.Z` range
   in `@dopl/cli` and `@dopl/mcp-server` `dependencies`.
5. Commit (scope the add so the release commit is just the package + lockfile):
   ```sh
   git add packages/<pkg> package-lock.json
   git commit -m "<pkg>: <summary> (vX.Y.Z)"
   git push origin master
   ```

### 2a. Publish via CI (preferred — needs the `NPM_TOKEN` secret)

Tag and push; `release.yml` builds, tests, verifies the tag matches
`package.json`, publishes, and cuts a GitHub release from the changelog section.

```sh
git tag mcp-server-v1.0.0     # form: <package>-v<version>; MUST equal package.json
git push origin mcp-server-v1.0.0
```
Tags: `client-v*` → `@dopl/client`, `cli-v*` → `@dopl/cli`, `mcp-server-v*` →
`@dopl/mcp-server`. Watch with `gh run watch`; verify with
`npm view @dopl/<pkg> version`.

**This path only works if the repo has an `NPM_TOKEN` Actions secret** with
publish rights to the `@dopl` scope. If the "Publish to npm" step fails with
`npm error code ENEEDAUTH` / an empty `NODE_AUTH_TOKEN`, the secret is missing or
blank (note: not every fork/mirror of this repo has it). Fix it once:

1. npmjs.com → **Access Tokens** → generate an **Automation** token (automation
   tokens bypass npm 2FA, which classic tokens and interactive logins do not).
2. GitHub repo → Settings → Secrets and variables → Actions → new secret named
   **`NPM_TOKEN`**.
3. Re-run the failed release: `gh run rerun <run-id> --failed` (the tag still
   exists, so no re-tag needed).

### 2b. Publish locally (fallback — when CI has no token)

After the Prep steps, from the repo root:

```sh
npm publish -w @dopl/mcp-server
```
If your npm account has 2FA enabled for writes, npm prints
`Authenticate your account at: https://www.npmjs.com/auth/cli/…` and waits —
press ENTER, approve in the browser, and it finishes with
`+ @dopl/mcp-server@1.0.0`. This **web-OTP flow needs a real interactive
terminal**; a sandboxed/non-interactive shell can't open the browser and falls
back to demanding `--otp=<code>`. Then still tag for history + the GitHub
release record:
```sh
git tag mcp-server-v1.0.0 && git push origin mcp-server-v1.0.0
```

> **Agents can't run the publish for you.** Harness guards block handling npm
> tokens and OTP codes, so a coding agent can do everything *up to* the publish
> (prep, lockfile sync, commit, tag, push) and everything *after* (verify,
> reload) — but **you** must run `npm publish` (or add the `NPM_TOKEN` secret and
> let CI do it). Don't paste a token into a chat; if you must, revoke it after.

If `@dopl/client` and `@dopl/cli` both have new versions, **publish the client
first** — npm resolves `^X.Y.Z` against the registry at install time, not the
local workspace.

### 3. Reload the MCP after publishing

The MCP is launched via `npx @dopl/mcp-server@<version>`, pinned in
`~/.claude.json` (both the `dopl` and `dopl-fidaris` server entries). Bump the
pins, then restart the client so it re-spawns the server (MCP servers start
fresh on every launch, so the new version is picked up):

```sh
sed -i '' 's#@dopl/mcp-server@OLD#@dopl/mcp-server@NEW#g' ~/.claude.json
# then quit Claude Code and relaunch — `/mcp` should list the new tools.
```

## Conventions cheat sheet

- **Files**: ≤300 lines target / 500 hard cap (CI fails over). Filenames `kebab-case`.
- **Imports**: external → `@/` → relative.
- **No `any`, no `@ts-ignore`.**
- **No comments unless the *why* is non-obvious.**
- **Commits**: `<scope>: <verb> <what>` — e.g., `cli: add packs validate command`. Banned: `fixes`, `wip`, `updates`, `stuff`.
- **One PR = one logical change.** Don't bundle.

See `docs/ENGINEERING.md` for the full set.
