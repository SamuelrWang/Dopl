# Dopl

Dopl is a shared workspace for people and their AI agents: channels, knowledge bases,
skills and an ontology, reachable from a macOS desktop app and, for any agent, over a
remote OAuth-authenticated MCP server (`/api/mcp`).

## Layout

| Path | What |
|---|---|
| `src/` | Next.js app — API routes, server features, web pages, `/api/mcp` |
| `apps/desktop-ui/` | `@dopl/desktop-ui`, the bundled SPA the desktop app loads |
| `dopl-desktop-app/` | Electron main process (separate npm project) |
| `packages/dopl-client/` | `@dopl/client`, typed HTTP client |
| `packages/mcp-server/` | `@dopl/mcp-server`, the MCP server engine |
| `packages/contracts/` | `@dopl/contracts`, shared wire types |
| `supabase/migrations/` | database migrations |
| `docs/` | INVARIANTS (current rules), ENGINEERING (history), specs, findings |

## Develop

macOS, Node 22.

```sh
npm install && (cd dopl-desktop-app && npm install)
cp .env.example .env.local                       # fill in

npm run dev                                      # web + API on http://localhost:3000
npm run dev:ui                                   # SPA on http://localhost:5173
cd dopl-desktop-app && DOPL_APP_URL=http://localhost:3000 npm run dev   # Electron on the local API
```

## Gates

Green = five suites, two lints, two typechecks and the non-suite gates listed in
[CLAUDE.md](CLAUDE.md) and [docs/INVARIANTS.md](docs/INVARIANTS.md) §14 (re-derive:
`grep -n 'run:' .github/workflows/ci.yml`). Commands: [TESTING.md](TESTING.md).

## Read next

- [CLAUDE.md](CLAUDE.md) — which doc to read, precedence (code > INVARIANTS > ENGINEERING), doc rules.
- [docs/INVARIANTS.md](docs/INVARIANTS.md) — how the system behaves now.
- [docs/ENGINEERING.md](docs/ENGINEERING.md) — why; dated history.
- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, packages, conventions.
