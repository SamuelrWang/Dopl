# MCP / architecture v2 — WAVE B, BATCH 3 (2026-09-02)

Branch `v2/wave-b`, continued from the batch-2 review fixes at `d7e1b2ed`. **Not pushed. No
migration applied. No KB sync.** Four `--no-ff` merges + eight integration commits; 430 files,
+12,065 / **−15,299**. Slice→commit→merge table: `docs/specs/mcp-v2-wave-b.md` §5, *"Batch 3
landed"*.

## What shipped

**Deletion was the batch, and the ledger is net −3,234 lines.** `workspace=` is a list-and-create
argument; there is no default workspace; the copy ops and `home_scoped` are gone and the `shelf`
axis is off the MCP surface (⚠ **not gone** — `GET /api/knowledge/bases?shelf=` and
`GET /api/agent-templates?shelf=` still take `home | workspace`, INVARIANTS §10);
the 22 redirect aliases, the `await` lane and the ping lane are retired. Thirteen tools became
**eleven**.

**A grant is read back — the wave's headline, and it was the one incomplete seam.** B11 ruled
*grants replace copies*; B15 shipped the write door and recorded (F-604) that nothing honoured it —
a lent row stays `private` and created-by-the-grantor, so in the scope it was lent TO both
`canSee*` and their policy twins refused it. The arm is one sentence written twice and only twice:
`shared/tenancy/resource-grant-reach.ts › grantedResourceIds` and
`20260923140000 › dopl_grant_admits()`, OR-ed onto a **closed** membership group in both readable
predicates. No policy moves, so the pair gate keeps finding its twins. ⚠ **AND THE SQL HALF WAS
WRONG UNTIL THE REVIEW** — see *Review fixes*, finding 1: the arm was OR-ed in at the TOP, outside
the shared-credential refusal both TS twins make two arms above it.

Three decisions inside it, each recorded where it is made: it sits **below** the shared-credential
refusal (a credential standing for nobody has no membership of the granted scope to read the grant
through) and **above** the `private` refusal (a lent row IS private); and `scope_type='team'`
answers FALSE, because that axis is already `dopl_teams_mode_visible()`'s. **Level is two
vocabularies**: `container` admits at `read` and `edit`, `channel` only at `visible`, because
`agent_only` names no human audience.

**`channel_resource_grants` is dropped**, its last reader having moved (F-460). The order is the
safety argument — the mirror WRITER goes before the table, and the migration RAISEs on any old row
absent from the new one, because `DROP TABLE` reports nothing.

**`dopl_home(op="create_channel")` gets a successor** (F-621). B13 retired it and named none, which
is a wire-visible deletion of a capability rather than a rename;
`dopl_workspaces(op="create_home_channel", name=)` takes it, inside the 450-char READ budget. `op`
is optional and defaults to the READ — a fence, not a convenience: `gating.ts › opRefusal` returns
`null` for an ABSENT op.

## Measured — the WHOLE WAVE, from wave-A start

Re-derive, never quote: `cd packages/mcp-server && npx vitest run src/tool-budget.test.ts`. The
ratchet fails on a SHRINK as well as a growth, so every figure below **is** the measurement.

| Metric | Wave-A start | Batch-1 | Batch-2 | **Batch-3** | Wave target |
|---|---:|---:|---:|---:|---:|
| **Served per external connection** | 95,174 | 51,996 | 49,790 | **46,851** | ≤30,000 |
| ↳ descriptions | — | 16,092 (13) | 16,097 (13) | **14,461 (11)** | ≤8,000 |
| ↳ input schemas | — | 34,053 (13) | 31,839 (13) | **30,589 (11)** | ≤19,000 |
| ↳ `dopl_channel` schema | — | 11,609 | 8,678 | **8,677** | 3,000 |
| ↳ `instructions` | — | 1,851 | 1,857 | **1,801** | ≤1,900 ✅ |
| **Doctrine (pulled)** | 32,551 | 32,551 | **8,960** | 8,960 | ≤9,000 ✅ |
| Tools served | 17 | 13 | 13 | **11** | 11 ✅ |
| `dopl_channel` ops / params | 23 / 35 | 23 / 35 | 5 / 23 | **5 / 23** | 5 / ≤20 ✅ / — |
| RLS-covered tables | 0 | 3 | 9 | **9** | 7 ✅ |
| Net lines | — | — | — | **−3,234 this batch** | ≥3,000 ✅ |

⚠ **95,174 IS THE WAVE-A-START FIGURE AND IT IS NOT COMPARABLE ROW BY ROW** — it was measured over
seventeen tools before A3 recomposed the surface, so only the TOTAL is a like-for-like. Five of the
six targets are met. **The served target is not, and the gap is the same one F-577 named**: 16,851
over, and it is FIELDS, not prose — `dopl_channel`'s 8,677 alone is 23 fields at ~130 chars each
including JSON Schema structure. Samuel's standing answer is a separate parameter-diet slice with
usage evidence per param.

The one RISE this batch: `dopl_workspaces` 114 → 364, on the one licence the ratchet accepts (a new
op). It replaced 1,160 (`dopl_home`'s 440 + 440, `current_workspace`'s 720).

## Guardrails ledger — final state

**Four of the six wave-B rows became CODE; two remain PROSE, and both by ruling rather than by
omission.**

| # | State after wave B |
|---|---|
| G4 | **CODE** — deleted rather than fenced; B15 removed the copy ops, so there is no ungated path. |
| G5 | **CODE** — one grant predicate over `resource_grants`, imported by knowledge and agent-templates (F-604), after the team axis retired. |
| G13 | **CODE** — deleted rather than fenced; one server-resolved recipient leaves nothing to arbitrate. 870 → 26 chars. |
| G17 | **CODE for `channel_agent`** — `Bash` off the bound AND in `disallowedTools`. |
| **G18** | 🟡 **PROSE, BY RULING.** Shell goes; `WebFetch`/`WebSearch` stay ("full minus Bash"). The residual is one ledger line (F-514). |
| **G20 / F-450** | 🟡 **PROSE, AND NOT BY RULING — BY DEFAULT.** The eighth session-health field was never added; `check-session-health-drift.ts` still measures SEVEN and no slice owned it. **Needs Samuel: land it or retire the guardrail.** |

## Migrations — SEVENTEEN pending, none applied, replay never run

`…0911` launch_direction_client_msg_id · `…0912` channel_delivery_verdict · `…0913`
channel_tasks_author_scoped_idempotency · `…0914` resource_grants · `…0915`
drop_agent_template_teams · `…0916` drop_team_resource_access · `…0917` mcp_token_credential_axes ·
`…0918` channel_default_responder · `…0919` rls_helpers_and_caller_scope · `…0920`
workspace_kind_personal · `…0921120000` rls_phase2_policies · `…0921130000`
channel_resource_grants_read_only · `…0921140000` resource_grant_trigger_arms · **`20260922120000`**
drop_default_workspace_rpc (B14) · **`20260923120000`** drop_home_scoped (B15) ·
**`20260923130000`** drop_channel_resource_grants (integration, F-460) · **`20260923140000`**
grant_read_arm (integration, F-604).

Verified at integration: **strictly increasing** across the pending set; every `ADD COLUMN` carries
`IF NOT EXISTS` (19/19); every `CREATE POLICY` and `CREATE TRIGGER` is preceded by a matching
`DROP … IF EXISTS`; the no-retired-table assertion (now PER TABLE — one shared cutoff could not
hold two drops nine versions apart) and the duplicate-version ratchet are both green.

### Apply order, and what is no longer a constraint

1. **Filename order, `…0911` → `…0923140000`.** 14/15/16 are ordered among themselves; 19 depends on
   14; `…0923130000` depends on 14's mirror existing; `…0923140000` depends on 19 and `…0921120000`
   (it replaces both their predicates in place).
2. ✅ **`20260920120000`'s CODE PRECONDITION (F-564) IS SATISFIED**, at the batch-3 integration.
   B13 repointed three sites and deleted one, B15 deleted one and fixed a ninth the scan could not
   see, B14 repaired the one FENCE, and the integration closed `tools/confirm-token.ts`, which was
   in no slice's `Owns` column. The gate's `OPEN_SITES` map is **deleted**, which is the sign-off;
   the header records that a precondition existed and was met.
3. 🔒 **`20260923120000` (drop `home_scoped`) HAS TWO PRECONDITIONS OF ITS OWN.** P1: `…0920` is
   applied. **P2: the personal-container flag has been default-ON for a release.** P2 is a DEPLOY
   fact, not a repo fact — this batch cannot satisfy it and does not claim to.
4. **F-583's six probes (P15–P20) and F-461's grant probes are still owed**, and this batch adds
   **five more (P21–P25)** on the grant read arm: container grant with/without membership, channel
   grant at `agent_only` vs `visible`, and (P25, added in review) any grant read through a SHARED
   credential.
5. 🔒 **`20260922120000` NEEDS `src/shared/supabase/types.ts` REGENERATED IN THE SAME APPLY.** It is
   the only pending migration that changes the FUNCTION surface the generated types describe —
   `default_workspace_of` and `ensure_default_workspace` out, `personal_container_origin_of` in —
   and that file is a §1 carve-out nothing typechecks against the database, so a stale copy declares
   two RPCs that answer `42883` and omits the one that works. Command, not the answer:
   `npx supabase gen types typescript --linked > src/shared/supabase/types.ts`.
6. **B8's ruling stands:** `20260907130000_channel_pings` is deleted, unapplied, forever.
7. ⚠ **Replay is SKIPPED — Docker is down** (`docker info` fails), as for all of wave A and all of
   wave B. **Every migration claim above is read out of SQL TEXT.** The `rls-redteam` CI job is the
   first thing that can pay any probe.

## Rulings taken here

- **F-602 — the grant door stays usable by AGENT credentials** (Desktop Agent default, Samuel may
  reverse; reversing is one flag). The owner-only fence is what makes it safe and it holds; the
  copy ops it replaced were agent-callable, so `sessionOnly` would be a regression wearing the
  conservative choice. ⚠ It became a real capability the same day, when F-604 landed.
- **F-621 — the mint moves to `dopl_workspaces`, UNCHARGED.** `MetaToolOptions.charged` is per
  TOOL, so charging it would meter the orientation read — the one call the tool exists to make
  free. This absorbs `dopl_home`'s ruling Q2 (b); a per-op charge is the change to make if the mint
  should cost. **The SHAPE wants Samuel's word**, not the whether.
- **F-663 — the MCP grant op offers `channel|container` and NOT `team`.** The column has three
  values; A8 took the team axis off this surface, and a grant op offering it would put it back
  through a different argument. Both read arms agree.
- **F-620 — ATTEMPTED AND NOT TAKEN, and the reason is not schedule.** It needs a NAME route
  (`packages/mcp-server` cannot import from `src/`), and *"refuse on >1 match, listing the
  container names"* contradicts `classifyMissingTemplateRef`'s shipped rule that it *"names a
  tenancy, never a roster"* (T35/A12). Picking here would overturn A12 silently.
- **F-662 filed rather than inferred**: the grant arm widens VISIBILITY, not the candidate set. A
  same-container grant works end to end; a cross-container one is admitted by the POLICY and still
  not returned by the service-role list paths. It closes as B5 moves reads onto the caller client.
- **F-466 — the retired-resource filter is deleted without waiting for replay**, because the
  question changed: the READER moved onto `resource_grants`, whose CHECK refuses `'workflow'`.
- **F-661 — a gate that could not fail was fixed, not documented.** `liveFunctionHeader` ignored
  `DROP FUNCTION`, so every "this function is gone" assertion was green by construction.

## Gates — all green, RE-MEASURED 2026-09-02 at `c66a3eb6` (the review head)

Five suites — root **5,675** (386 files, 29 skipped, **0 failures**), mcp-server **1,570** (101
files), client **59** (4 files), desktop-ui **432** (46 files), desktop **2,993** on a bare
`node --test`, which additionally collects `test/live/*.js` — both lints (root at
`--max-warnings 0`), both typechecks incl. `-w @dopl/desktop-ui`, and **ten** non-suite gates:
`check-doc-refs`, `size-check`, the five drift scripts, the RLS pair gate (5 predicates over 9
covered tables, four checks each), the committed-`dist` check, and the `rls-redteam` job.

⚠ **THE DELTAS ARE THE REVIEW'S OWN, AND EVERY ONE IS ACCOUNTED FOR.** Root +4 = two SQL-comparison
cases in `grant-read-arm.test.ts`, three structural grant-arm cases across the two redteam suites,
less one duplicate assertion deleted from `home-channel-derivation.test.ts`; skipped +2 = the two
live P25 probes. mcp-server +19 over +1 file = the desktop-fence suite (15), the mint's derived
address line, the exact-exemption case, and the two extra retired-vocabulary patterns. Desktop +1 =
the literal join in `session-await-refusal.test.mjs`.

⚠ **AND THE COMMITTED-`dist` CHECK WAS ONE OF THE TEN AND COULD NOT FAIL** — see *Review fixes*,
finding 10. The count is still ten; it is armed now.

⚠ **THE ROOT SUITE'S EXIT CODE IS 1 ON BOTH REVIEW RUNS, AND THE COUNTS ARE CLEAN.** The
`EnvironmentTeardownError` (*"Closing rpc while `onUserConsoleLog` was pending"*, from
`src/app/api/mcp/credits/consume/route-guest-floor.test.ts`) fired on both, which is the batch-1/2
flake behaving as recorded. **Read the counts, not the exit code.**

⚠ **AND A SECOND FLAKE FIRED THAT NO LIST NAMED — IT IS ADDED HERE RATHER THAN WAVED THROUGH.**
`src/features/auth/components/login-form-core.test.tsx › submitting after the switch runs sign-in`
failed on the FIRST full run (`Unable to find role="heading" and name "Log In"`, 1,448ms) and
passed on the second, and passes alone (9/9) and inside the scoped
`vitest run src/features src/shared`. It asserts on a heading revealed behind a 180ms CSS opacity
transition with no fake clock, so it is load-sensitive in the way the batch-2 `apps/desktop-ui`
contention note describes — **and nothing in this review touches auth or that component.** It is a
flake to WATCH, not a cleared one: the honest statement is two runs, one failure, cause not proved.
`apps/desktop-ui` was run alone, not concurrently with the root suite.

⚠ **THE `rls-redteam` GATE IS STILL THE ONE THAT HAS NOT RUN, AND IT IS THE ONE THAT MATTERS MOST.**
This machine has no Docker. **Nothing in these counts is behavioural evidence about a policy or a
trigger** — including the grant read arm, whose whole point is a policy.

⚠ **ONE REAL FAILURE WAS FOUND AND FIXED, AND IT WAS NOT IN A SLICE'S OWN GATES.**
`dopl-desktop-app/test/knowledge-read-ops.test.mjs` parsed `dopl_kb`'s op enum out of source, and
B15 made that enum a SPREAD — the parse read two identifiers as ops. It reads `KB_OPS` now, which is
the PUBLISHED set and the right subject. **Four slices each green alone; the cross-tree parse is
what only the merge could show.**

## Review fixes (2026-09-02, `13cac8d2` → `c66a3eb6`)

Five commits on `v2/wave-b`, **not pushed**. Nothing is CONTESTED — every finding reproduced.
Each fix carries a test that fails when the fix is reverted; the reverts were run, not assumed.

| # | Finding | Commit |
|---|---|---|
| 1 | 🔒 **BLOCKER — `dopl_grant_admits()` was OR-ed in at the TOP of both readable predicates**, outside the `NOT dopl_credential_is_shared()` arm and (on knowledge) outside the teams gate, while both TS twins refuse a shared credential two arms ABOVE the grant. The policy admitted what the service refuses. Both arms are `NOT dopl_credential_is_shared() AND dopl_grant_admits(…)` now, and the KB predicate AND-s its teams gate over the whole readable group, which is `assertBaseVisible`'s order | `13cac8d2` |
| 2 | …and the tests **PINNED the defect** — both redteam suites asserted `not.toMatch(/AND\s+dopl_grant_admits/)`, the exact wrong shape. They assert the guarded shape and refuse only the real nesting failure (the arm conjoined with `is_current_workspace_member`), and each gains structural + live **P25** | `13cac8d2` |
| 3 | `grant-read-arm.test.ts` compared TypeScript to TypeScript and was green about the half that was right. It replays the migrations the way the pair gate does and proves, per predicate, that the grant is unreachable except through the guard | `13cac8d2` |
| 4 | **MAJOR — four refusal routes named deleted things**: `TENANCY_FIX` → `dopl_agent op="copy", to_workspace`; `TENANCY_RULE` → "personal shelf"; the grant scope refusal and `GRANT_TO_ARG_DESCRIPTION` → `dopl_home(op="list_channels")` / `list_workspaces`; the mint → "workspace= on any other tool". All four repointed, the last RENDERED from `WORKSPACE_ARG_OPS` | `dad982c5` |
| 5 | …and the gate that should have caught them scanned only `listTools()`, `instructions` and the resources — **none of which carry a refusal**. `retired-vocabulary.test.ts` takes three sources now (served surface · every exported doctrine string · results driven out of their renderers) and bans the three deleted tool names and two ops. Reverting the four fixes fails five of its cases | `dad982c5` |
| 6 | **MAJOR — the `wait_ms` hold had no server-side fence.** Ruling below | `ac24f1b4` |
| 7 | **MINOR — eleven citations to modules that no longer exist.** The retired-channel-ops module (B16), the ping-inbox module and the SDK's ping module (the ping lane), and the session-pin module (B13) — whose dead `McpAuthContext.tokenId` field went with the citation. Plus six pointing at the deleted home-scopes module, repointed at `workspace-directory.ts › narrowToLock`. ⚠ **None of the five names is backticked above**: `check-doc-refs` existence-checks a backticked path, which is how this table would otherwise become five new dead refs | `3948b6f1` |
| 8 | **MINOR — one duplicate assertion** (`DECLARED` IS `FENCE_SITES`, so two cases said one thing) and **two constants that were one number**: `AUDIENCE_GRANT_LIMIT` folded into `GRANT_REACH_LIMIT`, both 500, each docblock claiming to be "the same number for the same reason" as the other | `3948b6f1` |
| 9 | **MINOR/NIT — the doc**: the `shelf` axis is off the MCP SURFACE, not gone (`?shelf=` is live on two REST routes); the apply checklist gains `20260922120000`'s `src/shared/supabase/types.ts` regeneration; P25 joins the owed probes | `3948b6f1` |
| 10 | 🔒 **FOUND WHILE RUNNING THE GATES — the committed-`dist` check could not fail.** `git status --porcelain -- 'packages/*/dist'` matches NOTHING: a git pathspec GLOB must match the whole path, so `git ls-files` answers 0 against 286 tracked files. It reported every stale build as clean from the day it landed, and it is counted among the ten. One `/*`, in ci.yml, CLAUDE.md and §14 | `c66a3eb6` |

### The `wait_ms` ruling, as taken

🔒 **`dopl_channel(op="read", wait_ms=…)` IS REFUSED SERVER-SIDE FOR A DESKTOP-RUN CALLER —
Desktop Agent default, and Samuel may reverse.** Reversing is `tools/identity.ts › isDesktopRun`.

The rule was doctrine already and the desktop enforces it in `session-permissions.js`, i.e. in ONE
runtime's permission gate. Another vendor's runtime, a raw loopback and a `full`-profile shell all
reach `/api/mcp` without passing through it, and each got the whole wake-length hold — a turn spent
asleep waiting for a message already arriving as a turn. **A rule stated in doctrine and enforced
by one client is not enforced.**

Two marks, either sufficient: the `X-Dopl-Runtime: desktop-session` stamp, or
`CallerIdentity.containerId` — the credential's own container lock, from `mcp_tokens.container_id`.
The second is why this is allowed to gate at all: it rides the TOKEN ROW rather than a header, only
`mcp-container-token.ts` sets it, and it sets it for one thing (a container session the desktop
spawned), so an agent with a shell can drop the stamp and not the lock. ⚠ **The HOLD is refused and
the READ is not** — nothing is withheld, which is why the sentence names no remedy. ⚠ An UNSTAMPED
caller keeps the hold: an older desktop build looks exactly like an external one, and the
fail-toward is a wasted long-poll rather than a lost message.

The refusal is the desktop's `AWAIT_DENY_MESSAGE` **verbatim** — two refusals for one bound, worded
differently, read to an agent as two different problems — pinned from the desktop side, reading
both sources, because `packages/*` cannot import that CommonJS main.

⚠ **ONE DECLARED EXEMPTION RIDES WITH IT AND IT IS OWED TO SAMUEL.** That sentence opens with the
word `await`, which `law-removed-vocabulary.ts` bans from every shipped `channel-*.ts` string
because B8 retired the op — the desktop's wording is one day older than the retirement (T85 is
09-01, B8 is 09-02). `VERBATIM_QUOTES` exempts that exact string, matched WHOLE, rather than moving
the constant out of the scanned glob, which would make the ban decorative. **Re-word both halves to
say "the hold", or ratify the quote.**

## What needs Samuel

1. **The shape of `create_home_channel`** (F-621) — on the orientation tool, a dedicated write
   tool, or app-only. The reversal is one enum member and one `WRITE_OPS` row.
2. **The new-user starter workspace** (B14, kept as built): a new user gets **one personal
   container and NO standard workspace**. Spec §3 row 2 and row 14 contradict each other on this
   and B14 took the narrower reading. It is a product decision, not a refactor.
3. **F-602** — ratify or flip the agent-usable grant door.
4. **F-576** — `direct_agent` → `manage(action="direct")`, ratification still requested from batch 2.
5. **G20 / F-450** — land the eighth session-health field or retire the guardrail. It is the last
   prose guardrail that is prose by default rather than by ruling.
6. **Two flag flips, both default-OFF and neither exercised**: `RLS_CALLER_SCOPED_READS` and
   `TENANCY_PERSONAL_CONTAINER`. `20260923120000` cannot be applied until the second has been ON
   for a release.
7. **The parameter diet** — the served target needs ~16,857 more and it is FIELDS. Samuel's
   standing answer is a separate slice with usage evidence per param.
8. **F-620's roster question** before its code question: may a >1-match refusal name the containers?
9. **The `wait_ms` fence** (review finding 6) — ratify or reverse; it is one predicate.
10. **The `await` word in the shared refusal sentence** — re-word both halves, or ratify the
    `VERBATIM_QUOTES` exemption that lets a banned word ship in exactly one string.
