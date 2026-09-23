# Review handoff — Codex parity, live rosters, agent identities, pin-model removal

Written 2026-09-23 for the cleanup/review agent. Master `1571f0e3`, **unpushed** (origin/master is
`aed2c860`). Nothing here has been deployed; two migrations are written and NOT applied.

## Scope to review

`git log --no-merges 450fafcd^..master` — every commit from the first Codex-runtime fix through the
pin-model removal. Grouped:

| Area | Commits (oldest → newest) |
|---|---|
| Codex runtime U1–U10 | `450fafcd` … `2b4de50f`, `efcdb7d6`, `f6f3db55`, `5d15823c`, `4c45b1fa`, `e490908d`, `ff79311d`, `5658e292`, `db6278e5`, `ab39cc32` |
| Codex MCP discovery + gate (CXP-3A) | `52299535`, `3fb94a37`, `4a8ed3a9`, `28295b39`, `496dcd98`, `ad894c9a`, `8716cfa5` |
| Direct-request settle (CXP-3B) | `139832a1` |
| Roster recovery + dead hook (CXP-5) | `e63fc3c1`, `2cbb2357` |
| `never` / delegation / skills fences | `e2d17ba3`, `afe96c19`, `ef9c6381` |
| Persistence/scheduling fence (C26) | `88358966` |
| Live Claude model roster | `daeecbd9`, `f2a38b2b`, `22315fcd` |
| agent templates → agent identities | `5e979a9a`, `fb089277`, `6dc3ca82`, `42518544`, `589919c2` |
| Pin-model removal + launch order | `a021755c`, `4c741f56`, `1571f0e3` |

Samuel's brief for this pass: remove unnecessary comments; well-structured; not flaky; not brittle;
good conventions; no repeated code; check collisions, edge cases and bugs.

## Deliberate behaviour — do NOT "clean up" these away

- **Every `dopl_channel` call reaches Dopl's gate** on every runtime and mode. On Codex that is why
  `never` is sent as a `granular` policy underneath (`runtime/codex/policy.js`) and `dopl_channel` has
  `approval_mode: 'prompt'` while other Dopl tools are `'approve'` (`runtime/codex/mcp.js`).
- **Claude is never launched in its widest mode** — `permissionMode: 'default'`; Dopl's gate
  implements bypass (`runtime/claude/launch-spec.js`).
- **Codex fences (all by configuration, not prompt text):** isolated `CODEX_HOME` + refusal of foreign
  `config.toml` (`config-home.js`); apps/plugins off (`tools.js › ACCOUNT_FENCE`); delegation off via a
  delegation-free model catalog (`catalog.js`); operator skills fenced (`skills-fence.js`); goals,
  sleep, memories, hooks off + `notify = []` (`tools.js › PERSISTENCE_FENCE`, `launch-spec.js`);
  project-trust self-writes retired (`496dcd98`).
- **Claude strips `Agent`/`Skill`** on every profile (`runtime/claude/tools.js › FULL_BUILTIN_BOUND`).
- **Runtime-aware discovery prompt:** Claude wording byte-identical; Codex told `tool_search` /
  `ALL_TOOLS` (`prompt-framing-discovery.js`).
- **Model resolution:** launcher pick → identity model (only if the launch runtime offers it) →
  runtime default (Claude `claude-sonnet-5`; Codex `gpt-6-sol` if the live catalog has it, else no model
  so Codex picks). An explicit unknown pick refuses with the offered list (`no-model`).
- **Rosters are live** (Claude `supportedModels()` handshake, Codex `model/list`); frozen tables are
  fallback only; no runtime borrows another's catalog.
- **Naming:** "agent identity" = a role of the user (DB `agent_identities`); "agent" = a running
  session in a channel. Channel page still says Agents. MCP param is `identity`; `template` is rejected.
- **Live tests that spend real OpenAI turns:** `gpt-6-luna`, effort `low`, no fast tier (one constant
  in `test/_codex-app-server.mjs`). Prefer the stub model provider.

Structural cleanups of these are welcome; behaviour changes are not. The fences WILL be loosened by
context after the release (Samuel ruling 2026-09-22: owner's private/full = native features on,
shared/restricted = off + toggle) — that is a separate change, not part of this review.

## Known open items (don't rediscover; fix only if trivial)

- Codex launch still reads a stored reasoning effort nothing can set any more (always per-model default).
- `session-private.js › openPrivateTurn`: a private message steered into a running Codex turn leaves
  `privateDepth` one too high (next channel turn runs with public posting withdrawn).
- A `turn/steer` racing a turn's end can fail the frame stream; fallback to `turn/start` would fix.
- A skill added to a fenced folder after launch isn't blocked.
- Codex `never`-shell can still schedule via `crontab`/`launchd` (shell fence's job, same as Claude).
- Native `spawn_agent` block depends on the catalog override; a model missing from every catalog
  source refuses the launch.
- Reasoning-effort option lists are still fixed on both runtimes.
- Cursor is OUT OF SCOPE (known: `session-reopen.js › setModelByTask` coerces Cursor ids to Claude aliases).

## Migrations (written, not applied — main session applies at release)

1. `supabase/migrations/20261018120000_channel_launch_directives_no_model.sql`
2. `supabase/migrations/20261019120000_rename_agent_templates_to_agent_identities.sql`

Server and desktop must ship together: a 1.35 desktop breaks against the renamed API/columns.

## Process rules

Own worktree; commit by path; never `git add -A` / `git stash`; never push. Gates: root `tsc`, root
lint `--max-warnings 0`, root vitest, `apps/desktop-ui` tests + typecheck, `packages/mcp-server` tests,
`dopl-desktop-app` `npm test` + `CODEX_APP_SERVER_LIVE=1 npm test` + lint, root `npm run build`,
500-line cap. Rebuild committed `packages/*/dist` if a package changes. Don't open the app or take
screenshots as verification.
