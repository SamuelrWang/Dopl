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
private transcript; `chats_owner_select` was unfenced. ⚠ **NINE covered tables after the review**, not eleven: D1 withdrew `knowledge_entry_chunks` (F-575 back to OPEN) and `skill_files` was a policy for a table dropped in July 2026 (F-586).
**No TS predicate was deleted; that is B16.**

## Measured, BEFORE (batch-1 end) → AFTER

Re-derive, never quote: `cd packages/mcp-server && npx vitest run src/tool-budget.test.ts`. The
ratchet fails on a SHRINK as well as a growth, so every ceiling below **is** the measurement.

| Metric | Batch-1 end | Batch-2 end | Wave target |
|---|---:|---:|---:|
| **Served per external connection** | 51,996 | **49,790** | ≤30,000 |
| ↳ 13 descriptions | 16,092 | 16,097 | ≤8,000 (11 tools) |
| ↳ 13 input schemas | 34,053 | **31,839** | ≤19,000 |
| ↳ `dopl_channel` schema | 11,609 | **8,678** | 3,000 |
| ↳ `instructions` | 1,851 | 1,857 | ≤1,900 |
| **Doctrine (pulled)** | 32,551 | **8,960** | ≤9,000 ✅ |
| Tools served | 13 | 13 | 11 (B13) |
| `dopl_channel` ops / params | 23 / 35 | **5 / 23** | 5 / ≤20 ✅ / — |
| RLS-covered tables | 3 | **9** | 7 ✅ |

**The doctrine target is MET and the served target is not, for one reason each.** Doctrine is
pulled, so deleting the six agent ops deleted `REFUSALS` and `CHANNEL_OWN_AGENTS` with them. The
served surface is 19,057 over: **the next real cut is fewer FIELDS, not shorter prose** — 3,000
over 23 fields is ~130 chars each including JSON Schema structure, which buys the number by
deleting the answer to *"does this op want this argument"* (F-577). B13 takes the next one
(`workspace=` off; `section`, `visibility` and `mode` are each the sole argument of one action).

## Migrations pending — THIRTEEN, none applied, replay never run

`…0911` launch_direction_client_msg_id · `…0912` channel_delivery_verdict · `…0913`
channel_tasks_author_scoped_idempotency · `…0914` resource_grants · `…0915`
drop_agent_template_teams · `…0916` drop_team_resource_access · `…0917` mcp_token_credential_axes ·
`…0918` channel_default_responder · `…0919` rls_helpers_and_caller_scope · **`…0920`
workspace_kind_personal** · **`…0921` rls_phase2_policies** (all `2026NNNN120000`), plus the
review's two: **`20260921130000`** channel_resource_grants_read_only ·
**`20260921140000`** resource_grant_trigger_arms. Both land after `…0921` and before batch 3's
reserved `20260922120000`.

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
3. 🔒 **`20260923120000_drop_home_scoped` HAS TWO PRECONDITIONS, AND THEY ARE NOT THE SAME (B15, 2026-09-02).** **P1** — `20260920120000` has run, so its §5 one-time move has already filed every `home_scoped` row in its author's container. **P2** — `TENANCY_PERSONAL_CONTAINER` has been DEFAULT-ON for a full release, and B15's code is deployed. ⚠ **P2 IS THE ORDERING TRAP.** §5's move ran ONCE; the flag decided where personal writes landed AFTERWARDS, so there is a window — containers minted, flag still off — in which every new personal write went to the shared workspace carrying the boolean. **Dropping the column then publishes those rows to their workspace with nothing anywhere that could notice.** The migration's §1 RAISEs on any such row rather than trusting the order; the flag is deleted from the code by B15, so once this file is applied there is nothing left for it to decide. The B15 code may land before the flag flip — it is the MIGRATION that waits.
4. **B8's ruling still stands:** `20260907130000_channel_pings` is deleted, unapplied, forever.
5. ⚠ **Replay is SKIPPED — Docker is down** (`docker info` fails), as it has been for all of wave A
   and all of wave B. Every claim above is read out of SQL TEXT. Only a database can say what a
   trigger does: F-461's grant probes and F-563's four personal-container claims are still owed.

## Rulings taken here

- **F-578, one deviation, and the finding's own last warning asks for it.** `OWN_CHANNEL_READ_OPS`
  is `['read','status','rooms.threads','rooms.members']`, not `[…,'rooms']` — four of `rooms`'
  eight actions WRITE, so a bare entry would have handed Axis B's INBOUND half a lane that opens
  channels and invites people into them. The action is part of the key everywhere, through one
  spelling (`main/channel-op-key.js › channelOpKey`), the grain the server's write gate already
  reads.
- **The TWENTY-TWO retired op names were REMOVED from every desktop list, not kept.** ⚠ This
  paragraph said EIGHTEEN, which is `23 − 5` — the net change in what the enum SHOWS, not the
  number of retirements. Twenty-two names retired and four arrived; `read` is the one old name
  that survived (`channel-retired-ops.ts › RETIRED_OPS`, which has always said twenty-two).
  This reverses
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
| **B14** default workspace off | `ensureDefaultWorkspace` → `ensurePersonalContainer`; `findDefaultWorkspaceForUser` → `findSoleOwnedStandardWorkspace`, billing-only; both `resolveHomeScope` copies repointed; `20260802200000` + `20260823160000`'s guard dropped; `default_workspace_of()` — ⚠ **NOT "for the revert only": it is a LIVE DEPENDENCY of `ensure_personal_container`**, which mints a container FROM today's default and reads it for the name and `created_at` (corrected 2026-09-02, in review). Dropping it before that mint stops running is a `CREATE OR REPLACE` away from an apply failure, not a tidy-up |
| **B15** copies off ✅ **DONE 2026-09-02** | the copy ops (681 MCP lines: `knowledge-ops-copy` 377 + `agent-ops-copy` 138 + the shared copy-target 166) + their two test files, the whole MCP shelf module and its argument, both `resolveHomeScope` copies, and `home_scoped` on both tables. ⚠ **`template-draft.ts` AND the deleted /home copy dialog (B15) ARE 490 LINES AND ONLY 240 OF THEM WERE THE COPY** — the deleted /home copy dialog (B15) (194) went whole, `containerCopyDraft` (~46) came out of `template-draft.ts`, and the other 250 are the shared editor draft, which `template-editor.tsx`, `agent-editor.tsx` and `agent-templates-core.tsx` all import |
| **B16** old ops + TS fences off | the 22 one-line redirects, the `await` lane (AWAITING 3,914 + two handlers + the budget module), the ping lane, the five `canSee*` predicates one at a time behind green redteam tests |
| **B9/B10 residue** | `channel_resource_grants` + the in-txn mirror, after `repository-audience.ts › listGrantedBaseIdsForChannels` moves (F-460); `agentIdsInChannel` and its two re-exports (F-579); `use-agents-panel.ts`'s duplicate thread-other-party derivation (F-551) |

## Gates — all green at `430007e4`, and RE-MEASURED after the review fixes

**AT `430007e4` (the batch-2 landing).** Five suites — root **5,645** (381 files, 26 skipped),
mcp-server **1,474** (99 files), client **58**, desktop-ui **433** (46 files), desktop **3,007** —
both lints (root `--max-warnings 0`), both typechecks incl. `-w @dopl/desktop-ui`, and **nine**
non-suite gates: `check-doc-refs`, `size-check`, five drift scripts, the RLS pair gate (11 covered
tables) and the committed-`dist` check, which is clean with no rebuild commit because no merge
after B8's `chore(dist)` moved package `src/`.

**AFTER THE REVIEW FIXES** (measured 2026-09-02, at the end of this document's *Review fixes*
section). Five suites — root **5,684** (384 files, 25 skipped), mcp-server **1,615** (100 files),
client **58** (4 files), desktop-ui **433** (46 files), desktop **3,007** (`npm test`) — both
lints at **0 errors / 0 warnings**, both typechecks, and **TEN** non-suite gates: the nine above
with the pair gate now over **9** covered tables and four checks instead of one, plus the new
`rls-redteam` job. `build:packages` leaves `packages/*/dist` clean.

⚠ **THE `rls-redteam` GATE IS THE ONE THAT DID NOT RUN, AND IT IS THE ONE THAT MATTERS MOST.**
This machine has no Docker — which is the reason the job exists. **Nothing in these counts is
behavioural evidence about a policy or a trigger.**

⚠ **THE ROOT SUITE'S EXIT CODE WAS READABLE THIS TIME (0), AND THAT IS NOT A FIX.** The
`EnvironmentTeardownError` below is a race; it simply did not fire on this run. **Read the counts,
not the exit code**, exactly as at batch 1.

⚠ **A BARE `node --test` IN `dopl-desktop-app` NOW REPORTS 3,016, NOT 3,007**, and both numbers
are right: `npm test` globs `test/**/*.mjs` and the bare form additionally collects the nine
credential-less cases in `test/live/*.js`. It used to report 3,017 with one PERMANENT failure
(F-595's smoke script), which is what made the discrepancy invisible.

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

## Review fixes (2026-09-02) — 1 BLOCKER, 14 MAJOR, 11 MINOR, 4 NITs

An Opus review of batches 1–2 at `2e277622`, applied on the same branch. **Still
not pushed, still no migration applied, still no KB sync.** Nineteen commits.

⚠ **THE FIXES ADDED TWO MIGRATIONS AND EDITED FIVE UNAPPLIED ONES.** The rule
taken, and it is worth stating because the two halves look inconsistent: a
migration that has **already applied** can only be corrected by a NEW file
(`20260921130000`, `20260921140000`); one that is **pending in this branch** is
still a draft, and a follow-up file re-stating a function it defines four
versions earlier is a second copy of a rule, which is what this wave spent B12
removing. So `20260914120000`, `20260917120000`, `20260919120000`,
`20260920120000` and `20260921120000` were edited in place, and the two new
files exist only where the object they change is live.

| Finding | Fix |
|---|---|
| 🔴 **BLOCKER** `service-writes.ts` — `authorKind` from the request body, so an agent credential could take RR3's channel-wide arm | `e8bdff10` — the claim ESCALATES ONLY (F-580) |
| `20260828120000` — the grant MIRROR kept a `FOR ALL` write policy | `37fcfe7a` — `20260921130000` drops it; both trigger writers become SECURITY DEFINER (F-581) |
| `enforce_resource_grant` — grantor arm asked membership, never the resource | `14389ce8` — `20260921140000`: edit-capable rank + `dopl_user_may_share_resource` (F-583) |
| …and the same arm made `ON DELETE SET NULL` undeletable | same commit — de-attribution is not a re-grant (F-584) |
| …and the backfill copied a departed grantor into a trigger that refuses one | same commit — carried as unattributed (F-582) |
| `20260921120000` — `knowledge_entry_chunks` deny-all → viewer-readable, flag or no flag | `f26ab450` — **D1**, the arm is withdrawn; F-575 returns to OPEN |
| `check-rls-pair-gate.ts` — asserted a policy NAME survived, and nothing else | `ee074b26` — four checks, `DROP TABLE`-aware replay (F-585) |
| …and its first run found a policy written for a table dropped in July 2026 | same commit — the `skill_files` block would have aborted the apply (F-586) |
| `rls-redteam-fixture.ts` — 26 behavioural cases skipped in every environment | `03a2d30e` — **D2**, the `rls-redteam` CI job. ⚠ **NOT RUN HERE** — this machine has no Docker, which is the reason it exists |
| three token minters wrote neither credential axis | `004b4caa` — **D4**, plus the subject-axis CHECK that makes `NULL/NULL` unrepresentable (F-587) |
| `errors-recipient.ts` — a mistyped `to=` returned every member's email | `8d3d4215` — the entitlement rule `channel-render.ts` already states (F-588) |
| RR2 keyed on a caller-supplied agent stamp, unchecked | same commit — checked against `ownLiveAgentIds` (F-589) |
| `personal-container.ts` — flipping the flag ON HID every row written before it | `d7758ae3` — the read stops asking the flag (F-590) |
| A16's three response-size knobs recorded as shipped, absent from the tree | `175db662` — **D3**, all three wired (F-591) |
| `law-scan.test.ts` globbed one tool; five strings routed to retired ops | `7708499a` — every non-test module, plus a retired-op check (F-592) |
| four doc claims measured against the tree | `162a599b` — the retired-op count, G20/F-450, `default_workspace_of`, the MCP shelf module's refusal (that module is deleted in B15) |
| the delivery ack proved the session, never that the message was FOR it | `b6f5dadb` — fence (3) (F-593) |
| Cursor's frozen table fell through to `full` for the profile it refuses | same commit (F-594) |
| a bare `node --test` failed permanently on an Electron entry point | same commit — `scripts/smoke.js` (F-595) |
| `agentIdsInChannel` dead since B9 | same commit — F-579 CLOSED |
| three NITs: a bare `i.op`, a stale `read_directions` sentence, two missing `SET search_path` | `752f1399` |
| F-564's precondition was prose, and its count disagreed with its own `grep` | `6fbd4c9a` — a gate; **the migration may be applied when its map is empty** |
| five "who will this reach" implementations, none agreeing with another | `cdfe4965` — one fixture table for the two that matter (F-551 part-paid) |
| `types.ts` "stale" | `7a6fa6be` — it is generated from the DEPLOYED database and is correct about it; the header says when it stops being |

### The five decisions, as taken

**Desktop Agent defaults. Samuel may reverse any of them.**

- **D1 — `knowledge_entry_chunks` stays DENY-ALL.** Every other arm of
  `20260921120000` narrows; that one widened a table from "nobody" to "every
  viewer", **regardless of `RLS_PHASE_2`, because a policy is not behind a
  flag.** The F-575 trap is directional — the cost of no policy is an EMPTY
  search the day a chunk read moves, never a leak — so the policy belongs in
  phase 3, with the reader it unblocks. **Covered tables: 11 → 9** (the other
  one is F-586's).
- **D2 — the live redteam runs in CI.** `supabase start && db reset` on an
  ubuntu runner, then the five files with `RLS_REDTEAM_LIVE=1`. `db reset` makes
  it the REPLAY gate §12 has been recording as owed. **It has not run; its first
  CI run is where these suites are proved.** The local skip-with-reason stays.
- **D3 — the three knobs ship.** `fields=` (with `id` outside it by
  construction), `response_format`, `max_chars`. Three ceilings rise 736 chars;
  the licence is the four earlier knobs'.
- **D4 — all three minters write both axes**, and the subject axis is pinned to
  the legacy pair by CHECK, so `NULL/NULL` — the one shape whose fallback reads
  as the account owner — cannot be stored while both lanes exist.
- **D5 — the grantor arm is a rank AND the resource's own test**, and the
  `ON DELETE SET NULL` transition skips it.

### Contested

- **"`channel-retired-ops.ts:6` / `channel-schema.ts:126` say eighteen"** —
  CONTESTED. Both source files have always said **twenty-two**
  (`channel-retired-ops.ts:5`, `channel-schema.ts:14`). The wrong number was in
  three DOCS only, and `23 − 5 = 18` is where it came from: that is the net
  change in what the enum SHOWS, not a count of retirements. Docs corrected.
- **"three served strings route to retired ops"** — CONTESTED AS AN UNDERCOUNT.
  There are **five**, and one of them had a green test holding it in place.

### Needs Samuel

1. **F-576 — ratification requested.** `direct_agent` → `manage(action="direct")`
   is permanent, against the spec's row that retires the op outright. The
   reviewer judges it acceptable; it is a surface decision and wants his word.
2. **G20 / F-450 did not become code.** The eighth session-health field was
   never added. Land it in batch 3, or retire the guardrail.
3. **The migration set is now THIRTEEN**, none applied. `20260921130000` and
   `20260921140000` join the eleven, both after `…0921` and both before batch
   3's reserved `20260922120000`.
4. **F-583's six behavioural probes (P15–P20) are owed** with F-461's and
   F-563's. The `rls-redteam` job is the first thing that can pay any of them.
