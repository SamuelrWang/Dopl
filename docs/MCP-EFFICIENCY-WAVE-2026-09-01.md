# MCP Agent-Efficiency Wave — 2026-09-01

Six branches, integrated onto `integration/mcp-efficiency` off `master` `80be1bc6`. Spec:
the orchestrator check-in loop should be **3 calls**, write results **≤300 chars**, refusals
explainable without opening the repo, and template/KB reuse **1 call** each.

⚠ **NOTHING HERE IS SHIPPED.** The branch is commit-local and unpushed, so **CI has not run** —
it cannot, without a push. Red CI is a P0; treat every gate figure below as a local measurement.

## Merge order and merge commits

Order is not cosmetic — it decides finding-id allocation and who owns a contested file.

| # | Tier | Merge commit | Owns, on conflict |
|---|---|---|---|
| 1 | `p0/mcp-efficiency-bugs` | `0ff54f1a` | the `await` lanes: cursor-first timeout, banner kept |
| 2 | `p3/mcp-tenancy-naming` | `78e8be6a` | the tenancy sentences (by reference, never re-typed) |
| 3 | `p1/mcp-terse-results` | `43b8b3a3` | every tool description and every write-result renderer |
| 4 | `p2/desktop-lifecycle` | `8f07f1ea` | `dopl-desktop-app/main/**` |
| 5 | `p2/orchestrator-surface` | `f322e9cc` | the new ops and their server/client halves |
| 6 | `p2/needs-you-ping` | `a7e7849b` | the ping lane end to end |

Integration commits on top: `f5c045b9` (chain honesty, committed onto tier 5 before its merge),
`2a6e9f13`, `649fe42d`, `2e46d4f7`, `d56d7865`.

## Ticket → status

| Ticket | Status | Where |
|---|---|---|
| T01 KB-attach 500 | **done** | `f0bdffdb`, `c1305a10` — service skips the empty row write, repository is total on it |
| T02 `await` misses messages | **done** | `03f5b7ab`, `e148f28a` — self-echo filter is session-scoped with **no account fallback** |
| T03 `await` unusable externally | **done** | `ea93c41e` — hold sized to the caller's runtime stamp |
| T04 unreadable-create refusal | **done** | `21a34a2b` |
| T10–T13 terse results | **done** | `072df4f0`, `02fe86a4`, `242d730d`, `32a0745f` — one `key=value` line; doctrine at `dopl://doctrine/channels` and `op="help"` |
| T20–T22 `dopl_status`, cross-channel read, all-sessions | **done** | `60f873ed`, `8e0f52b5` |
| **T23 end_session** | **PRE-EXISTING — nothing was built** | The capability is `dopl_channel(op="end_agent")` and it was **already on `master` at `80be1bc6`** (`grep -c end_agent` in `tools/channel-schema.ts` there → 4). ⚠ It was listed as "done" against this wave's two commits until 2026-09-02; `end_session` has **zero hits in the tree**, so the row was crediting a build that never happened and naming an op that does not exist. |
| T24 launch posture | **done** — echo writer closed in integration (GAP A), closing **F-410** | `12b8ebd4`, `8688f333` + the integration commits |
| T25 silent denial visible | **done** | `808281b0` |
| T30–T37 tenancy naming | **done** | `9ecec274`, `75896738`, `8cb1b344`, `1966e5d4`, `2648cdf1`, `f9c82af2`, `fdf961b2` |
| T40 `copy` / `copy_base` | **done** | `10554ae8` |
| T41 session workspace pin | **done** | `60f873ed` |
| T50/T51/T83 wake ack, staleness | **done** | `ac592151` |
| T70 "needs you" ping | **done** | `a333dd30` → `db4bd51f` |
| T81 pinned startup context | **done** (framing closed in integration) | `09c1ea2f`, `be1fe1dc`, + GAP B |
| T85 await refused on a desktop session | **done** | `11f8a527` |
| **T82 description budget** | **PARTIAL — ratcheted, not met** | seven descriptions exceed the 1,200-char cap and sit on a **downward-only ratchet** in `tool-budget.test.ts`. Each is at its smallest *honest* size; getting under the cap means deleting a headline, an op line, a pinned security phrase, or `channel-description.ts › HOME_CHANNEL_ADDRESSING` (~650 chars the P3 tier asked to keep verbatim). **That is a decision, not a trim — Samuel's to take.** |
| **T84 SDK cache TTL** | **SKIPPED** | `@anthropic-ai/claude-agent-sdk@^0.3.220` exposes no cache-TTL option. Nothing to build against. |

## What the integration itself had to decide

- **`channel-description.ts`** → P1's version. P3's three constants survive **byte-identical**;
  `TENANCY_RULE` / `TENANCY_FIX` moved to `channel-doctrine.ts` because P1 made the description
  import `DOCTRINE_URI`, and keeping them put would close a module cycle whose loser is a **TDZ
  throw at connect time**.
- **The `await` untrusted-body banner STAYS on both await lanes**, position-pinned. Its asymmetry
  with `op="read"` is **F-407**, filed and deliberately unresolved. Do not close it by deleting
  the header — that is the cheap direction.
- **The launch `no-template` refusal names the tenancy FIRST**, as three causes, in the doctrine.
  P1's restructure had reduced it to two and dropped the tenancy cause the P3 tier added (T35).
- **`set_agent_mode` and `dopl_status` were re-rendered to `factsLine`.** They arrived in the
  pre-terse style; P1's convention wins, with the verdict as a token and the paragraph in the
  doctrine.
- **Findings renumbered.** Three branches each allocated from master's `F-403`. Desktop tier →
  `F-408`/`F-409`/`F-410`; orchestrator-surface → `F-411`/`F-412`. The rule that prevents it —
  *allocate from the highest id claimed on any live branch* — is now in the findings log header
  and `CLAUDE.md`. ⚠ `check-doc-refs` catches a DANGLING id, never a COLLIDING one.
- **Four files were split back under the 500-line cap**, all pushed over by the merge:
  `channel.ts` → `channel-dispatch-agents.ts`, `channel-render.ts` → `channel-framing.ts`,
  `schema-sql.test.ts` → `schema-sql-sessions.test.ts`, `channel-ops-launch.test.ts` →
  `channel-ops-launch-body.test.ts`.
- **Three defects existed only in the merged tree** and are filed and fixed: **F-413** (an offline
  `set_agent_mode` answered `not renamed`, from a two-armed ternary over a set that grew to three),
  **F-414** (`dopl_status` had NO security framing — a banner was moved into a DIFFERENT tool's
  description, and "said once" is only true relative to a reader who reads the place it is said),
  and a stale desktop tool list that omitted `dopl_status` (`main/tool-profiles.js`, caught by
  `test/tool-profiles.test.mjs`'s drive against the server's own registrations).
- **GAP C was a real wire defect, not a copy fix.** `directiveFrom` flattened a stored `chain:false`
  to `null`, so it inherited a channel setting that may be ON; `resolveChain`'s `false` arm fell
  through to the same place. **The two hid each other** — the wire never delivered a `false` for the
  resolver to get wrong — which is why the suite now drives both halves composed. Mutation-verified:
  3 reverts, 4 failures each, 0 vacuous.

## Migrations — ALL FOUR WRITTEN, NONE APPLIED

`supabase db reset` was **NOT run**: Docker is installed on this machine but not running, and
applying to a remote was out of scope. Per §12, replay is the only check that means anything, so
these are claims.

```
20260907130000_channel_pings                       (T70)
20260908120000_knowledge_pinned_startup_context    (T81)
20260909120000_channel_sessions_health             (T50/T51/T83)
20260910120000_channel_launch_directives_posture   (T24)
```

They order correctly after master's latest (`20260907120000_channel_launch_directives_kind`).

⚠ **`channel_pings` ONCE SHARED A VERSION PREFIX WITH THAT MIGRATION** — both were
`20260907120000`. **Renamed to `20260907130000_channel_pings.sql` on 2026-09-02, while still
unapplied.** Filename order had resolved it locally, but the `supabase_migrations.schema_migrations`
history is upserted `ON CONFLICT (version) DO UPDATE`: one row would have survived and `…_kind`
would have vanished from `migration list` entirely. `supabase migration list` prints VERSIONS while
every doc cites FILENAMES (§12, F-304), so still join on the name:

```
supabase migration list
```

## What is left for Samuel

1. **Apply the four migrations** — locally with Docker running (`supabase db reset` → exit 0),
   then to the remote. Verify all four landed as four distinct rows (the `20260907120000` prefix collision was removed on
   2026-09-02 — `channel_pings` is now `20260907130000`).
2. **Push the branch so CI can run.** Every gate below was measured locally; CI is the gate.
3. **Rule on T82** — which sentence comes out of the over-cap descriptions, or that the ratchet is
   the answer. Two were TRIMMED under the cap during integration (`current_workspace`,
   `dopl_status`); three were ratcheted because they grew on NEW OPS that `parity.test.ts` requires
   by name. Seven remain over.
4. **`main/launch-directive-wire.js` is at 495 of 500 (F-415)** — the next correction to the module
   that owns the wire vocabulary is a split, not a doc fix. Deliberately not done here.
5. **Ship, or don't.** Nothing here has been shipped and nothing will be without your word.

## Gates, measured locally on the integrated branch

Five suites, two lints, two typechecks and **FIVE** non-suite gates — re-derived from
`.github/workflows/ci.yml`, not quoted.

⚠ **THE DOCS SAID FOUR NON-SUITE GATES AND WERE WRONG, FOR THE THIRD TIME AND IN THE SAME
DIRECTION.** `scripts/check-css-token-drift.ts` has been the `type-drift` job's third step since
`522f53df` (2026-08-31) and appeared in no doc. That is the same failure `check-role-drift.ts`
produced a month earlier: **the wave that adds a gate does not add its doc row.** INVARIANTS §14
and CLAUDE.md are corrected in this branch, and both now carry the re-derive command rather than
the number.

Two known flakes rerun green in isolation and are **not** integration breakage:
`src/app/api/mcp/credits/consume/route-guest-floor.test.ts` (worker teardown race) and
`src/shared/version/latest-release.test.ts` (real clock).
