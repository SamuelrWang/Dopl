# MCP / architecture v2 — WAVE B, BATCH 2 (2026-09-02)

Branch `v2/wave-b`, continued from the batch-1 integration at `1a0283f7`. **Not pushed. No
migration applied. No KB sync.** Five `--no-ff` merges + eight integration commits; 302 files,
+12,099 / −7,884. Slice→commit→merge table: `docs/specs/mcp-v2-wave-b.md` §5, *"Batch 2 landed"*.

## What shipped

**`dopl_channel` is five ops.** `send · read · status · manage · rooms`, 23 → 5, with a one-line
redirect per retired name for one release. Every bound moved into a rendered `Limits:` block and
every rule into the doctrine, which is now **pulled** rather than pushed: 32,551 → 8,960 chars, the
single largest saving in either wave. `summary` is 200 everywhere. A16's three response-size knobs
(`fields=`, `response_format`, `max_chars`) ride the same ratchet.

**The desktop executes the server's verdict instead of re-deriving it.** LLM TRIAGE is deleted
whole — the session triage module, its three per-runtime halves, the wake-tiers module and four
test files (named without anchors: an anchor at a deleted file is a claim it exists) — `classify` collapses to two questions (279,936 generated cases, 0 diffs), and delivery feeds only
the recipient the server resolved. Twelve rules over "who wakes" across three modules are one
stored verdict. −2,479 / +991.

**Tagging is discoverable, and a draft says who it will reach.** The @-picker offers the channel's
LIVE agents and members through the peer-safe projection, inserts the exact server token, and the
composer prints the recipient line RR1/RR2/RR3 will actually resolve.

**Every user gets one container.** `kind='personal'`, minted by `ensure_personal_container` with an
owner membership and a one-per-owner unique index; the `home_scoped` shelf moves into it by
`created_by`. Dual-write behind `TENANCY_PERSONAL_CONTAINER` (default **off**) — the column still
carries the truth.

**RLS phase 2 makes the policy the fence for four more tables.** `skills`, `agent_templates`,
`chats`, `resource_grants` (+ `skill_files`, `chat_messages`, `agent_template_knowledge_bases`,
`knowledge_entry_chunks` as children), each read rule stated ONCE in a predicate the policies call.
Four wider-than-fence gaps closed (F-570): skills had no shared-credential arm and said nothing
about `access_mode='teams'`; `chats_member_select` led with a blanket admin arm that read every
private transcript; `chats_owner_select` was unfenced. **Ten covered tables, 11 with F-575.**
**No TS predicate was deleted; that is B16.**

## Measured, BEFORE (batch-1 end) → AFTER

Re-derive, never quote: `cd packages/mcp-server && npx vitest run src/tool-budget.test.ts`. The
ratchet fails on a SHRINK as well as a growth, so every ceiling below **is** the measurement.

| Metric | Batch-1 end | Batch-2 end | Wave target |
|---|---:|---:|---:|
| **Served per external connection** | 51,996 | **49,057** | ≤30,000 |
| ↳ 13 descriptions | 16,092 | 16,097 | ≤8,000 (11 tools) |
| ↳ 13 input schemas | 34,053 | **31,103** | ≤19,000 |
| ↳ `dopl_channel` schema | 11,609 | **8,678** | 3,000 |
| ↳ `instructions` | 1,851 | 1,857 | ≤1,900 |
| **Doctrine (pulled)** | 32,551 | **8,960** | ≤9,000 ✅ |
| Tools served | 13 | 13 | 11 (B13) |
| `dopl_channel` ops / params | 23 / 35 | **5 / 23** | 5 / ≤20 ✅ / — |
| RLS-covered tables | 3 | **11** | 7 ✅ |

**The doctrine target is MET and the served target is not, for one reason each.** Doctrine is
pulled, so deleting the six agent ops deleted `REFUSALS` and `CHANNEL_OWN_AGENTS` with them. The
served surface is 19,057 over: **the next real cut is fewer FIELDS, not shorter prose** — 3,000
over 23 fields is ~130 chars each including JSON Schema structure, which buys the number by
deleting the answer to *"does this op want this argument"* (F-577). B13 takes the next one
(`workspace=` off; `section`, `visibility` and `mode` are each the sole argument of one action).

## Migrations pending — eleven, none applied, replay never run

`…0911` launch_direction_client_msg_id · `…0912` channel_delivery_verdict · `…0913`
channel_tasks_author_scoped_idempotency · `…0914` resource_grants · `…0915`
drop_agent_template_teams · `…0916` drop_team_resource_access · `…0917` mcp_token_credential_axes ·
`…0918` channel_default_responder · `…0919` rls_helpers_and_caller_scope · **`…0920`
workspace_kind_personal** · **`…0921` rls_phase2_policies** (all `2026NNNN120000`).

Verified at integration: **strictly increasing** across the pending set; every `ADD COLUMN` carries
`IF NOT EXISTS`; every `CREATE POLICY` and `CREATE TRIGGER` is preceded by a matching
`DROP … IF EXISTS` (2/2, 11/11, 2/2, 3/3, 6/6 per file); the no-retired-table assertion and the
duplicate-version ratchet are both green (`schema-sql.test.ts`, 18 cases).

### Apply order, and the two constraints that are not just ordering

1. **Filename order, 0911 → 0921.** 14/15/16 are ordered among themselves and 19 depends on 14.
2. 🔒 **`20260920120000` HAS A CODE PRECONDITION (F-564).** Eight sites derive "this is a home
   channel" from `!isStandardWorkspace(w)` rather than `kind === "link"`
   (`grep -rn '!isStandardWorkspace' packages apps src --exclude-dir=dist`). They are correct by
   accident while `standard` and `link` are the only kinds. **This migration makes that false for
   every user at once** — each would advertise a personal container as a home channel. A MISLABEL,
   not a leak, so it does not block the code landing; it blocks the migration running. Either each
   site asks `kind === "link"`, or B13/B15 delete the surface — but only if the deletion lands
   FIRST. `confirm-token.ts` is in no slice's `Owns` column and needs assigning.
3. **B8's ruling still stands:** `20260907130000_channel_pings` is deleted, unapplied, forever.
4. ⚠ **Replay is SKIPPED — Docker is down** (`docker info` fails), as it has been for all of wave A
   and all of wave B. Every claim above is read out of SQL TEXT. Only a database can say what a
   trigger does: F-461's grant probes and F-563's four personal-container claims are still owed.

## Rulings taken here

- **F-578, one deviation, and the finding's own last warning asks for it.** `OWN_CHANNEL_READ_OPS`
  is `['read','status','rooms.threads','rooms.members']`, not `[…,'rooms']` — four of `rooms`'
  eight actions WRITE, so a bare entry would have handed Axis B's INBOUND half a lane that opens
  channels and invites people into them. The action is part of the key everywhere, through one
  spelling (`main/channel-op-key.js › channelOpKey`), the grain the server's write gate already
  reads.
- **The eighteen retired op names were REMOVED from every desktop list, not kept.** This reverses
  the 2026-08-22 note that kept `get_thread` on the read set as a fail-safe. A name in no list
  GATES, so only the ALLOW side shrank.
- **G13's claim protocol deleted rather than kept as the standing half** (B9's commit body leaned
  on it surviving). A session that was not named is not fed, so the question it asks cannot arise —
  and it had fired zero times across 40 real messages before that. 870 → 26 chars.
- **`threadOpen` deleted, not left unreached.** A thread open and an escalation are `send`s now, so
  both carry the `outbound_post` frame that mints F-321's card.
- **F-576 amended toward what SHIPPED**, not toward the spec: `direct_agent` →
  `manage(action="direct")`. Nothing in the tree files a direction for an IDLE recipient, so
  retiring the op on the spec's row would have deleted the private lane rather than moved it.
- **F-562's split was FORCED, not chosen** — B11 and B12 both grew
  `agent-templates/server/repository.ts` to 515 and the root lint's `max-lines` went red.

## What batch 3 deletes — the exact list from all five slices

| Slice | Deletes |
|---|---|
| **B13** `workspace=` off | `session-pin.ts`, `home-scopes.ts`, `noWorkspaceError`, the auto-target, both pin ops, `dopl_home`; `current_workspace`+`list_workspaces` → one `dopl_workspaces` (13 → 11 tools). Also the four `!isStandardWorkspace` sites it owns (F-564) |
| **B14** default workspace off | `ensureDefaultWorkspace` → `ensurePersonalContainer`; `findDefaultWorkspaceForUser` → `findSoleOwnedStandardWorkspace`, billing-only; both `resolveHomeScope` copies repointed; `20260802200000` + `20260823160000`'s guard dropped; `default_workspace_of()` (B11 shipped it DEPRECATED, for the revert only) |
| **B15** copies off | the copy ops (681 MCP lines + 490 draft/UI), `shelf.ts` (+ its `SHELF_ARG_DESCRIPTION` "default workspace" wording and ratchet), `copy-target.ts`, `home_scoped` on both tables |
| **B16** old ops + TS fences off | the 18 one-line redirects, the `await` lane (AWAITING 3,914 + two handlers + the budget module), the ping lane, the five `canSee*` predicates one at a time behind green redteam tests |
| **B9/B10 residue** | `channel_resource_grants` + the in-txn mirror, after `repository-audience.ts › listGrantedBaseIdsForChannels` moves (F-460); `agentIdsInChannel` and its two re-exports (F-579); `use-agents-panel.ts`'s duplicate thread-other-party derivation (F-551) |

## Gates — all green at `430007e4`

Five suites — root **5,645** (381 files, 26 skipped), mcp-server **1,474** (99 files), client **58**,
desktop-ui **433** (46 files), desktop **3,007** — both lints (root `--max-warnings 0`), both
typechecks incl. `-w @dopl/desktop-ui`, and **nine** non-suite gates: `check-doc-refs`,
`size-check`, five drift scripts, the RLS pair gate (11 covered tables) and the committed-`dist`
check, which is clean with no rebuild commit because no merge after B8's `chore(dist)` moved
package `src/`.

⚠ **THE ROOT SUITE'S EXIT CODE IS STILL UNREADABLE, AND FOR THE SAME REASON AS AT BATCH 1.**
`src/app/api/mcp/credits/consume/route-guest-floor.test.ts` raises an `EnvironmentTeardownError`
(*"Closing rpc while `onUserConsoleLog` was pending"*) that vitest counts as an unhandled error and
exits 1 on, with **0 test failures and 381/381 files passing**. It is inherited, not introduced —
verified at `v2/wave-a` `523bfc92` during batch 1. **Read the counts.** No other listed flake fired.

⚠ **AND A SECOND, ENVIRONMENTAL ONE WORTH RECORDING:** `apps/desktop-ui` reported 8 failures across
6 files when run CONCURRENTLY with the full root suite on this machine, and 433/433 when run alone
seconds later. It is resource contention between two vitest pools, not a code fault — but a CI
matrix that parallelises these two jobs on one runner would see it.

⚠ **Desktop is 3,007, DOWN from 3,048 at batch 1, and that is the deletion.** B9 removed four test
files with the triage tier (`wake-tiers`, `wake-tier-routing`, `wake-triage-call`, plus the
harness's third method) and added `wake-routing.test.mjs`.

## What needs Samuel

1. **The eleven pending migrations, and the F-564 precondition on `20260920120000`.** Nothing here
   may reach production before the wave-A seven are applied, and `…0920` may not be applied before
   the eight `!isStandardWorkspace` sites are fixed or deleted.
2. **Replay.** Docker has been down for two full waves. F-461 (grant-trigger probes), F-563 (the
   personal container's four claims) and every RLS redteam suite's LIVE half are owed.
3. **Batch 3 needs his word** (spec §5: "only after batch 2 has run one release"), and B14 needs
   the §7 billing answer — the default taken is (a), the owner's sole owned standard workspace,
   refusing on ambiguity.
4. **F-577's remaining gap**, if the ≤30,000 target is to be met this wave: it is fewer FIELDS, and
   the fields are each one op's sole argument. B13 is the next cut; after it the target still needs
   ~19k somewhere.
5. **F-572 / F-573 / F-574 filed for RLS phase 3** — `teams/` reads two covered tables on the
   service role and is in no slice's `Owns` column; two `skill_files` WRITE policies still take the
   caller-supplied user id; the skills KB picker has no service-side visibility filter (mitigated
   only with the flag ON).
