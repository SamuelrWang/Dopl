# MCP / architecture v2 — WAVE B, BATCH 1 (2026-09-02)

Branch `v2/wave-b`, cut from `v2/wave-a` @ `523bfc92`. **Not pushed. No migration applied. No KB
sync.** Eight `--no-ff` merges + six integration commits; 241 files, +10,925 / −1,633.
Slice→commit→merge table: `docs/specs/mcp-v2-wave-b.md` §5, *"Batch 1 landed"*.

## What shipped

**The fences got real.** `resource_grants` is one table for three scopes (channel · container · team)
with one trigger, replacing two tables, six copies and a five-migration trigger chain; the team axis
is gone and the team CAPABILITY survives as a scope. RLS phase 1 mints a caller-scoped Postgres JWT
behind `RLS_CALLER_SCOPED_READS` (default **OFF**, throws without `SUPABASE_JWT_SECRET`) over the
three knowledge tables, with the policies repaired to equal the TS predicate — two wider-than-fence
gaps closed on the way — and a CI pair gate that every `canSee*` has a named policy twin. **No TS
predicate was deleted; that is B16, behind green redteam tests.**

**A credential now states its two axes.** `mcp_tokens` carries `container_id` + `subject_user_id`,
so `isSharedCredential` is one null check instead of a three-arm question over a lock; WHOSE reach a
credential inherits is no longer inferred from WHICH container it is fenced to (F-336/F-333).

**An id resolves its own container** for knowledge bases, skills, chats and templates — one shared
`readResourceById`, and both launch lanes follow the id (ruling #18).

**Send has semantics.** `to=` is a union (uuid · email · `@handle`), an `@name` that resolves to
nobody is a 400 listing live handles, and RR1/RR2/RR3 resolve a forgotten address ONCE at write
time, stored on the row. `RESILIENCE_WINDOW_MS` = 15 min, declared once in `shared/channels/caps.ts`.

**Containment gained a fourth profile.** `channel_agent` = `full` minus the shell, denied by NAME on
the wire; the header carries a PROFILE and the role table is deleted, with a genericity test that
fails the build on a persona word.

## Migrations pending — nine, none applied, replay never run

`20260911120000` launch_direction_client_msg_id · `20260912120000` channel_delivery_verdict ·
`20260913120000` channel_tasks_author_scoped_idempotency · `20260914120000` resource_grants ·
`20260915120000` drop_agent_template_teams · `20260916120000` drop_team_resource_access ·
`20260917120000` mcp_token_credential_axes · `20260918120000` channel_default_responder ·
`20260919120000` rls_helpers_and_caller_scope.

Apply **in that order** — 14/15/16 are ordered and 19 depends on 14. Verified at integration:
strictly increasing versions across the pending set, `IF NOT EXISTS` / `DROP … IF EXISTS` on every
add, and no file sorting after a drop names a retired table. ⚠ **Replay is SKIPPED: Docker is down**,
as it was for all of Wave A — every claim above is read out of SQL text, and only a database can say
what a trigger does (F-461's probes are still owed).

`20260907130000_channel_pings` is **deleted, unapplied** (ruling B8). Two APPLIED migrations share
version `20260901120000` — pre-existing, named in F-526, and now fenced so a second cannot ship.

## Rulings taken

- **F-513 (default; Samuel may reverse).** "Shared" is ANY channel with more than one member, whatever
  container it sits in. The borrowed container predicate (`kind='link' && memberCount !== 1`) called a
  nine-member `standard` workspace SOLO. The FACT and the RULE are separate functions, so reversing
  it is one predicate.
- **F-491, to the SPEC.** `kind` stays `message | milestone | decision`; `done|question|blocked` are
  not adopted, the enum was not touched, and the ping fold stays in B8/B16.
- **F-481.** The spec's B3 ownership row corrected to `service-launch-template.ts`.
- **F-500.** INVARIANTS §11 `DOPL_SAFE_TOOLS` 11 → **12**, with the re-derive command beside it.

## What batch 2 consumes

| Contract | Where it is now |
|---|---|
| `delivery=` verdict enum + the RR window | `packages/contracts/src/channels.ts`, `src/shared/channels/caps.ts › RESILIENCE_WINDOW_MS` (15 min); verdicts `delivered · woken · idle · unreachable · none · refused` |
| the `to` union field | `src/features/channels/schema.ts › ChannelMessageCreateSchema.to`, resolved in `server/service-writes.ts`; ⚠ neither file is in any slice's `Owns` column (F-492) — **assign both in batch 2's map** |
| the profile table | `packages/mcp-server/src/gating.ts › PROFILE_TOOLS` + `TOOL_PROFILES` (four values); desktop twin `main/tool-profiles.js › KNOWN_PROFILES`. The two lists are now asserted EQUAL — a fifth name is a two-sided change |
| `resource_grants` shape | `(workspace_id, scope_type ∈ channel\|container\|team, scope_id, resource_type, resource_id, level, guest_write)`, `enforce_resource_grant()`, and an in-transaction mirror into `channel_resource_grants` for `repository-audience.ts` (F-460 — batch 3 moves the reader, then drops both) |

**Blocking nothing.** B8 may start on `v2/wave-b` as it stands.

## Gates — all green at `a950e733`

Five suites (root **5,556**; mcp-server **1,445**; client **58**; desktop-ui **433**; desktop
**3,048**), both lints (root `--max-warnings 0`), both typechecks incl. `-w @dopl/desktop-ui`, and
**nine** non-suite gates re-derived from `grep -n 'run:' .github/workflows/ci.yml` — `check-doc-refs`,
`size-check`, five drift scripts, the RLS pair gate, and the committed-`dist` check (clean without a
rebuild commit: no merge after B5's `chore(dist)` moved package `src/`).

⚠ One known flake hit on the full root run — `shared/version/latest-release`, green in isolation.
