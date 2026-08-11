# Refactor Findings Log

A running log of bugs, conflicts, friction, and suspicious patterns discovered during the structural refactor. Entries are added the moment something is noticed — not batched. Each entry has a stable ID that commits can reference.

See [docs/ENGINEERING.md](ENGINEERING.md) for the target architecture.

**Pruned 2026-07-17:** a three-agent audit verified every entry against the live tree; resolved/obsolete findings were removed so this file holds only OPEN debt. Removed IDs (details in git history of this file): F-001–F-015, F-018, F-019, F-021, F-022, F-024, F-025, F-028–F-032, F-034, F-039. IDs are never reused. The second of two entries that both carried "F-038" was renumbered to F-040.

**Pruned 2026-07-31:** every remaining entry was re-verified AGAINST THE CODE AT HEAD (not against commit messages — several entries had been written by agents that were mistaken). Deleted as genuinely resolved: F-020, F-043, F-045 (body; one follow-up kept), F-046, F-047, F-056, F-057, F-062, F-069, F-082, F-084, F-086, F-087, F-088, F-089, F-090, F-095. Deleted as STALE rather than resolved — the code they describe no longer exists: **F-065** and **F-066**. **F-041** was deleted as superseded by F-093. Entries that were only PARTLY resolved were rewritten down to the open half rather than deleted (F-042 item 3, F-092, F-093, F-094, F-096, F-098, F-099, F-100, F-101, F-102). IDs are never reused.

**Reconciled 2026-08-08 (second pass, after the split + fix wave landed).** Deleted as RESOLVED: **F-045** (`useInvalidateBillingStatus` now has callers — remove-member and approve-join — closed by the members conversion, recorded in F-159) and **F-054** (both halves: the web `state` echo was already shipping, and all THREE desktop auth legs now arm `requireState:true` and fail closed in both directions; the magic-link leg, the last presence-only flow, closed the same night. The auto-updater half shipped 2026-07-26). **F-166's dangling `F-09x` code reference is fixed**, though its SSRF residual stays open. **F-174's open half is closed** (trust re-derived at consume time). **F-159 is rewritten**: the "~80 write sites" scope is done for all four families, and what remains is the layer's own debt. Nine new ids, F-179–F-187. Every number written in this pass was re-measured — file sizes with `wc -l`, sanitizer adoption with a diff count, all five suites actually run.

**Pruned 2026-08-08 — the big one. 112 entries in, 82 out, and the file is now in STRICT NUMERIC ORDER** (it had drifted into three interleaved blocks, so "the newest entry" and "the entry after F-102" were different places). Every entry was re-verified against the WORKING TREE ON DISK — not against commit messages, not against another entry, and explicitly not against its own text, because that is what the last two prunes found wrong most often.

- **Deleted as RESOLVED (29):** F-037, F-050, F-052, F-121, F-122, F-124, F-125, F-126, F-127, F-128, F-129, F-130, F-131, F-132, F-134, F-135, F-136, F-137, F-138, F-139, F-140, F-142, F-143, F-147, F-148, F-149, F-151, F-154, F-157. *(Note on F-050: it was "closed (moot), kept struck-through because the resolution line is a live hazard". It is now DELETED, which is strictly safer — deleting the entry deletes the dangerous sentence, and the invariant it protected has three permanent homes: ENGINEERING §7 "DELETES ARE PERMANENT", the header of migration `20260807110000_purge_soft_deleted_rows.sql`, and the DM delete copy itself.)*
- **Deleted as STALE (2)** — the code they describe no longer exists, which is a different thing from fixed: **F-117** (its whole subject is two routing lanes racing; `main/channel-agents.js` and the addressed-agent lane are deleted, so the shape cannot occur and the product question it was waiting on is moot) and **F-153** (superseded — its live half is re-derived and re-measured under F-093, and its two open `eslint.config.mjs` deletions were both performed).
- **Rewritten down to the open half (34):** F-026, F-040, F-042, F-044, F-054, F-059, F-070, F-071, F-078, F-081, F-085, F-093, F-094, F-102, F-104, F-106, F-109, F-110, F-111, F-112, F-113, F-114, F-115, F-116, F-118, F-119, F-120, F-123, F-133, F-141, F-144, F-145, F-146, plus every entry from tonight's wave that shipped with an open follow-up (F-150, F-155, F-156, F-158, F-159, F-163, F-164, F-165).
- **`F-09x` FINALLY HAS A NUMBER: it is now `F-166`.** The 2026-07-31 note said to assign one on the next pass; this is that pass. ⚠ One dangling reference this pass could not fix (read-only outside the docs): `dopl-desktop-app/main/avatar-cache.js:42` still says "tracked as residual in F-09x". One-line follow-up.
- **F-160, F-161 and F-162 were NEVER ASSIGNED** — verified with `git log -S` over this file's whole history. They are gaps, not deletions. Per the standing rule they are still never to be used. F-169 through F-178 were assigned on 2026-08-08 — the migration replay, then the channels-audit fix wave: notify scope, the stale cron, `propose_close`, channel delete, agent containment, the desktop reliability round, and the thread reopen echo + already-closed guard.
- **F-179 through F-187 assigned 2026-08-08 (this pass), from the split + fix wave:** the `doplToolsPolicy` outage, the `reconcile-seats` raw Stripe text, the layer's missing predicate invalidation, the autoGrant conflict-team panes, the `session_ended` double-render, the durable-500-cause gap, the teams cross-feature writes, the `members-tab` no-op props, and the pending-auth store pair. **The next free id is F-189.**

- **F-188 assigned 2026-08-10** (the debt-fix wave, commit `a02f692`): the consent inbox's missing workspace scope — a **user-reported** bug, and the only entry in this file so far that arrived that way rather than from an audit. Closed in the same wave. That wave also closed **F-067**, **F-186**, and **F-100's MCP half**, halved **F-060** (size cap) and **C-20** (addressing), and closed both of **F-159**'s remaining site-level items plus **F-178**'s `coldKeys` promotion. **Every number in this pass was re-measured**, not copied: all five suites were run (root 2674 / 180 files, SPA 177 / 27, desktop 2541, mcp-server 556 / 40, dopl-client 75 / 4 — all green), and the F-085 correction below came out of re-reading the code rather than the entry.

- **F-189 through F-192 assigned 2026-08-10** (the security-rulings wave, commit `1d11a31` — C-12, C-13's visibility half, C-15 both halves, C-20's sweep half, with all four `20260810*` migrations APPLIED to production): the DM-close liveness regression the tombstone-hiding RLS policy created, the per-column-redaction failure mode that migration accepts, the departed-user rows that the C-20 sweep does NOT touch, and the un-CDN'd desktop download. **F-179 CLOSES in the same pass** — its open question was a production question, and the production query answered it (below). **The next free id is F-193.**
  - **Every number in this pass was re-measured, all five suites run on the working tree: root 2733 / 186 files, SPA 177 / 27, desktop 2541, mcp-server 556 / 40, dopl-client 75 / 4 — all green.** Note root moved 2674 → **2733** (+59) and 180 → **186 files** in one wave; the 2707 in `1d11a31`'s own commit message was already stale by the time the docs were written, which is the third time in this file's history that a suite count in a commit message did not survive to the doc pass. Read the runner, not the message.
  - **Two operational facts were verified by MEASUREMENT, not by reading the commit:** (1) `list_migrations` returns all four `20260810*` versions — applied. (2) `CRON_SECRET` **IS SET AND LIVE** — all three `/api/cron/*` routes answer **401** unauthenticated where they answered 503 before (`https://www.usedopl.com/api/cron/{oauth-cleanup,reconcile-seats,stale-threads}`; note the apex 307-redirects to `www`, so a curl without `-L` reports 307 and proves nothing). See the correction under "what this pass found" below — a dozen doc lines still said "unset".

**⚠ TWO CANDIDATE FINDINGS FROM THIS PASS WERE NOT ASSIGNED IDS, DELIBERATELY** — the duplicated cold-cache filter (`coldKeys` / `ifCold`) and the unpinned M4 component wiring. Both were already recorded as open items **inside F-178**, by the agent that created them, and filing them again would have produced two ids pointing at debt that already has a home. **Checking before allocating is the rule this file keeps re-learning from the other direction** (F-160–F-162 are gaps because ids were allocated and never used). A finding that already has an owner does not need a number; it needs the owner's entry to stay open. **Vindicated 2026-08-10:** the cold-cache filter closed inside F-178 exactly as an owned open item, with no id ever allocated to it; the M4 wiring is still open in the same place.
- **Three entries ADDED from what the verification itself turned up:** F-166 (the renumber), **F-167** (two migration files renamed out of a version collision — they will re-apply on the next push), **F-168** (another member's KB/skill body reaches your tool-capable agent unframed, which contradicts a decision F-101 recorded as deliberate).

**What this pass found that is worth repeating.** The 2026-07-31 note said to verify against code, not commit messages. The failure mode this time was one level up: **entries verified against ANOTHER ENTRY.** F-146 wrote "assessed and left" over a residual set nobody had re-read; F-151 corrected that and was itself right; and then F-153's status line ("the two `eslint.config.mjs` deletions are OPEN and assigned to nobody") was already false when it was written, because a sibling agent had performed all three deletions in the same wave. Three of tonight's status lines were stale in the same direction — **they described the tree as of the moment the agent started, not the moment it finished.** A status line is a measurement and it expires; re-read it before you act on it.

**What the 2026-08-10 pass found that is worth repeating: A FACT ABOUT THE ENVIRONMENT ROTS EXACTLY LIKE A FACT ABOUT THE CODE, AND NOTHING LINTS IT.** `CRON_SECRET` was unset for weeks and that sentence propagated into a dozen places — two `src/**` docblocks, an ENGINEERING §7 bullet, three audit findings, a roadmap row, the KB entry — each of them true when written and each of them load-bearing (three separate fixes were described as "inert until the secret is set", which was the reason not to worry about them). **It is now SET; all three `/api/cron/*` answer 401 where they answered 503.** Nobody was going to notice, because an env var has no diff. Note also that the check itself is easy to get wrong: the apex `usedopl.com` **307-redirects to `www`**, so `curl` without `-L` returns 307 and looks like neither answer. **The lesson generalizes past this variable: any doc sentence of the form "X is not configured yet" is a claim about a system nothing in this repo can observe, and it should be re-measured on sight rather than trusted.** ⚠ **The two `src/**` copies are still stale and are NOT fixed by this pass** (docs-only scope): `src/app/api/cron/stale-threads/route.ts:84` and `route.test.ts:7,217` both assert the secret is unset in Vercel — and the test's comment reasons about which branch "every run" takes, which is now the wrong branch. One-line follow-up, code-side.

**And the deploy state in every entry was stale.** Twenty-seven entries carried "committed on `master`, **unpushed**" or "committed on `min-version-gate`, unmerged, undeployed". `git log origin/master..master` is **0** and `min-version-gate` is fully merged. Deploy state does not belong in a debt log — it goes out of date silently and nothing ever revisits it. The one deploy fact worth tracking is UNAPPLIED MIGRATIONS, and that is now the open half of **F-169**.

---

**Pruned 2026-08-11 (fourth pass) — the resolved-in-place sweep. 105 entries in, 91 out.** Scope: every entry carrying RESOLVED / ✅ / "closed" in its title or status line was re-verified **against the working tree on disk** — greps for the named symbols and files, never the entry's own text, never another entry, never a commit message. Strict numeric order survives; the entry template is unchanged. No code was touched and no `git` state was changed. **Where a claim was about PRODUCTION rather than about code, it was settled with read-only introspection against the live project** (`pg_constraint`, `pg_indexes`, `pg_proc`, `pg_publication_tables`, `schema_migrations`) — see the near-miss below for why that was not optional.

- **Deleted as RESOLVED (12):** **F-067** (three-valued `DECISION_OK`/`SETTLED`/`FAILED` at `main/consent.js:149-169`; `submitDecision` at `:213` is the sole entry point and all four call sites use it), **F-156** (both blocks — all six migrations on disk and applied; the USING-INDEX-not-FULL rationale and the "must stay after `20260807110000`" ordering constraint have a permanent home in that migration's own header, `:64-90` and `:142-168`), **F-167** (both blocks — `20260708120001` / `20260708150001` renamed on disk, and F-169's two-sided diff confirmed the remote history records both), **F-168** (`narration.isForeignAuthored` at `:109`, both surface-scoped headers, both read ops, 16-test file present — the essentials inlined into F-101 so the reference does not dangle), **F-171** (route on the `channel_tasks_stale` RPC, `excludeAuthorFilter`, `insertMessage`; its last open step was `CRON_SECRET`, now done — the surviving operational item moved to F-133), **F-173** (`is_direct` branch at the service; **the routed dialog copy landed verbatim** — `channel-pane.tsx:468,470`), **F-174** (`revalidateAutoAllow` on all three consume paths in `consent-service.ts`; `UNRESOLVED_TOOL_PROFILE = "read_only"`), **F-176** (`service-tasks-lifecycle.ts`, `service-writes-metadata-markers.ts`, `updateTaskIfStatus` all present; its one "open" bullet was explicitly *left alone as correct guidance*, not debt), **F-179** (the `server.tools` assignment is gone — `sdk-loader.js:216` records where it stood — and `alwaysLoad: true` survives at `:190`), **F-183** (see the refutation note below), **F-186** (both props gone from `members-tab.tsx` AND `members-section.tsx`), **F-188** (`workspaceId` is a required field on `ConsentListOpts`, `repository-collab.ts:91`, filtered at `:105`).
- **⚠⚠ THE MOST IMPORTANT THING THIS PASS PRODUCED IS A NEAR-MISS, NOT A REFUTATION — AND THE STALE SOURCE WAS THE WORKING TREE ITSELF.** This pass came within one edit of writing a loud, confident, **false** refutation into this header. It had drafted: *"F-099's ✅ is wrong, the charset CHECKs are not in production."* **They are in production.** The reasoning that produced the error is worth more than the entry:
  - Three prior prunes established the rule **"verify against the working tree on disk, not against entries or commit messages."** This pass followed it. `supabase/migrations/20260808150000_replay_hardening_wave_20260731.sql` **opens with `-- UNAPPLIED. DO NOT run without reading this header.` and repeats `-- NOT APPLIED. This is a repo file only.` at `:76`.** That is a primary source, on disk, in the file that owns the DDL — and it is **stale**, because a migration header is authored *before* the apply and nothing on earth updates it afterwards. `docs/LAUNCH-READINESS-ROADMAP.md:5` says the same thing and is stale for the same reason.
  - What caught it was an accident: F-102's status line disagreed. Chasing that disagreement into `pg_constraint` gave ground truth — **`profiles_display_name_check` present, `channels_name_check` present *in its charset-bounded form* (not the loose length-only inline one), `channels_topic_check` present, all 14 `*_charset_check` present, `channel_agents_engaged_idx` dropped, `supabase_realtime` at exactly 17 tables, and local files 157 = history rows 157 with zero local-only and zero remote-only.** Everything the 2026-07-31 wave was supposed to do is live, via the replay migration, applied 2026-08-09.
  - **THE RULE, and it is a genuine amendment to this file's doctrine: "the working tree" is not one thing.** For a question about CODE, the tree is authoritative — that is what the last three prunes were right about. For a question about **DEPLOYED STATE** — is this constraint live, is this migration applied, is this env var set — **the tree contains only claims, and every one of them was written before the answer existed.** A `.sql` header, a docblock, a roadmap row and a findings entry are all the same kind of evidence there: someone's note-to-self, frozen at authoring time. **The database is the only witness for the database.** This is the same shape as the 2026-08-10 `CRON_SECRET` lesson, one level more dangerous, because a migration file *looks* like the artifact rather than a comment about it.
  - **And note which direction the error ran.** Every previous prune found entries claiming *resolved* when they were open. This one nearly recorded an entry as *open* when it was resolved — and would have sent someone to re-apply DDL that is already live. **A prune's own output is a status line and expires exactly like the ones it corrects.**
- **Two status lines were genuinely stale, in opposite directions, both corrected:** **F-183** carried `RESOLVED 2026-08-09` in its title and `Status: open (needs Samuel's decision)` on its last line — the code is resolved (`group-thread-render.ts:164` routes `isSessionEndedMarker` to `notices`, two tests present), so the entry is deleted and the status line was simply never updated. **F-133** was the reverse: its title asserted `CRON_SECRET` is unset, which the 2026-08-10 measurement had already refuted.
- **Deleted as RESOLVED BY MEASUREMENT (2 more, on top of the 12 above):** **F-099** (the ✅ was correct — see the near-miss; the charset CHECKs are live) and **F-094** (`clusters` / `channel_agents` / `workflow_*` are all out of `supabase_realtime`, which publishes exactly 17 tables — its "written, not applied" premise is false; its `realtime.list_changes` sizing survives in F-091, which is the finding that would actually move the number).
- **Rewritten down to the open half (7):** **F-100** (MCP half verified closed and deleted; the open half is that `member-row.tsx:88,95-97` renders every member's email to every member with no admin-or-self test anywhere on the web path), **F-133** (premise refuted; what survives is that **no run of any of the three cron jobs has ever been observed**, and `stale-threads`' first non-empty run lands ~2026-08-14), **F-169** (both big halves closed by measurement; what remains is two cosmetic repo-vs-prod drifts that keep `db diff` permanently noisy), **F-172** (see below), **F-175** (two field-triggered residuals), **F-177** (one conditional; its third open item deleted as stale), **F-178** (the M4 component wiring, still unpinned — verified: none of the four test files in `apps/desktop-ui/src/features/channels/` mentions `membersStale`, `rosterStale`, or the help string).
- **⚠ F-172's OPEN HALF ENUMERATED THE WRONG SITES, and the one it missed is the loudest.** The bullet named `channel-description.ts:68` (now fixed) and a test comment. It never listed the **`propose_close` SUCCESS response** — `channel-ops-threads.ts:301`, mirrored in the shipped `dist/` — which still ends *"Do not propose again; a repeat collapses into the same prompt."* That is what the agent reads **immediately after proposing**, it contradicts the corrected description, and `channel-closed-thread.test.ts:172` asserts its presence, so fixing the copy turns the suite red. A well-behaved agent still never re-proposes: the finding's actual defect is live. **The lesson is about the shape of the miss, not the sentence — a copy sweep that lists the sites it can think of will always be a strict subset of the sites that carry the rule. Grep the RULE, not the file you remember.**
- **Deleted as STALE (0 entries; 1 sub-item).** The ~10 oldest open entries (F-016, F-017, F-023, F-026, F-027, F-033, F-035, F-036, F-038, F-040) were each re-checked at the symbol level and **every one still points at live code** — `resolveWorkspaceSegmentForUser`'s legacy branch, `computeEffectiveAccess`/`effectiveResourceAccess`, `listMessages`/`listVisibleChats`/`countHiddenChats`, the two timestamp-CAS sites, all four `features/clusters` files, all four copied workflows components. Nothing to prune there this pass. The one stale sub-item removed is **F-177's `doplToolsPolicy`-as-`string[]` follow-up**, which describes an assignment F-179 deleted.
- **Five open entries carried refuted DEPENDENCY or DEPLOY-STATE sentences and were corrected in place, not re-litigated:** F-064 and F-105 both said their mechanism is "inert until `CRON_SECRET` is set" — it is set, so F-064's proposed `expire-consent` cron would go live on its first deploy rather than sitting inert, which changes the cost of the fix rather than merely the wording. **A dependency on an unconfigured environment is the same rotting fact as the environment itself, one hop out.** F-091's "apply F-156 first" ordering note, F-102's title ("the unapplied migration" — it is applied), F-110 item (l)'s "application state unknown", and F-141 item (c)'s "application unverified" were all repointed at what has now been measured.
- ⚠ **ROUTED, NOT FIXED — a doc outside this file's ownership is stale in the same way.** `docs/LAUNCH-READINESS-ROADMAP.md:5` still lists `20260808150000` (replay hardening), `20260415000000` (the recovered baseline) and the two F-167 renames as **unapplied**, and warns to run `migration repair` "before the next push or they re-apply". **All four are recorded in `schema_migrations`; there is nothing to repair and nothing will re-apply.** This pass was docs-scoped to REFACTOR-FINDINGS.md only. One-line follow-up in that file.
- ✅ **The one code-side follow-up the 2026-08-10 pass left open IS DONE** — that pass warned that `src/app/api/cron/stale-threads/route.ts:84` and `route.test.ts:7,217` still asserted the secret was unset. Verified on disk: `route.ts:83-92` now carries an "OPERATIONAL HISTORY (secret SET 2026-08-10)" block and the test's comment at `:218-221` reads "The secret is set now". Nothing in `src/**` still says unset. That warning is retired.
- **IDs: nothing reassigned, nothing reused. F-160, F-161 and F-162 remain permanently unused.** (This pass allocated none; concurrently with it, F-193 was allocated for the release-pipeline gaps and RESOLVED same-day by `scripts/release.sh` + the §18 doc corrections — entry deleted per the standing rule, 2026-08-11. **F-194 is allocated below for F-074's orphaned debt; F-195 for the optimistic-write idempotency scope (found by the INVARIANTS verification); the next free id is F-196.**)
- **SUITE COUNTS WERE NOT RE-MEASURED AND MUST NOT BE READ AS CURRENT.** This pass ran **no suites, no `eslint`, no `tsc`, and no migration commands** — the only things it executed were **read-only** production SELECTs against system catalogues (no DDL, no writes, no `db push`, no `repair`). **The table under "Current gate" is as of its own stated date and every suite figure quoted in the 2026-08-10 note above is as-of that pass.** Per this file's own doctrine, treat all of them as expired measurements until someone re-runs them. **The migration and constraint facts in this note ARE freshly measured (2026-08-11) and are the exception.**

- **Census at the end of this pass: 91 entries, all open.** No entry in this file is now marked resolved. Bucketed: **~24 actionable-now** (a bounded change with no external dependency — F-096, F-097, F-104, F-108, F-123, F-145, F-146, F-152, F-163, F-164, F-172, F-178, F-180, F-181, F-182, F-184 and the smaller residuals inside F-042, F-070, F-078, F-081, F-101, F-116, F-159, F-170); **~19 awaiting-Samuel** (a product call, prod DDL, an account he owns, or an observation only he can make — F-044, F-048, F-055, F-058, F-061, F-064, F-091, F-100, F-105, F-114, F-133, F-141, F-155, F-158, F-169, F-190, F-192, plus the containment questions in F-068 and F-174's successors); **~30 accepted-residual** (recorded so the trade is not rediscovered as a mystery — F-023, F-033, F-035, F-036, F-085, F-106, F-107, F-109, F-110, F-111, F-112, F-113, F-115, F-118, F-119, F-120, F-144, F-150, F-165, F-166, F-175, F-177, F-185, F-187, F-189, F-191 among them); **~18 scale-triggered** (correct today, wrong at a size nobody has reached — F-016, F-017, F-026, F-027, F-038, F-040, F-049, F-051, F-053, F-059, F-060, F-063, F-071, F-072, F-073, F-092, F-093, F-102). Entries with residuals in more than one bucket are counted by their heaviest item, which is why the buckets sum above 91.

**Doc-anchor sweep, 2026-08-11 (a separate, docs-only pass — it added `scripts/check-doc-refs.mjs` and wired it into CI).** The new check asserts that every `F-NNN` mentioned anywhere in `docs/*.md` resolves either to a live `### F-NNN:` heading here or to a mention in THIS HEADER — because this log's convention is that a resolved entry is DELETED and the header is where the deletion is recorded, so a dangling id is a bug only when the header never recorded it. Across 536 id references in 22 docs it found exactly **two** that resolved to neither. Both are tombstoned here rather than re-entered:

- **F-074 — deleted-unlisted.** It was a real entry (the token/kit hand-copies: `apps/desktop-ui/src/styles/tokens.css` and `kit.css` against `src/app/globals.css`) and it went out in the 2026-08-08 big prune **without appearing on any of that pass's three lists**. ⚠ **It was not resolved.** Five live references still name it — both SPA style files, `apps/desktop-ui/CONVENTIONS.md`, `docs/ENGINEERING.md`, `docs/migration-research/packages-and-build.md` — and the hand-copies they warn about are all still on disk. The id is recorded so it stops dangling; **the debt itself now has no entry, and whoever next touches the kit should file it under a NEW id rather than resurrect this one.**
- **F-076 — never-assigned.** It has never been a heading in this file at any commit (checked with `git rev-list --all`). It appears exactly once in the whole repo, in `docs/ENGINEERING.md`'s v1.9 bullet — *"Stop (F-076)"* — written by `834584e`, which allocated the number in prose and never filed the entry. Same class as F-160–F-162: **a gap, not a deletion, and never to be reused.**

## Status legend

- **open** — not yet addressed
- **deferred** — will be fixed post-refactor; captured for future work
- Resolved entries are deleted from this file (git remembers); reference their ID + this file's history.

## Severity

- **bug** — incorrect behavior, runtime risk, or security concern
- **conflict** — two places in the codebase that disagree or duplicate each other
- **smell** — pattern that will cause pain later (not currently broken)
- **question** — needs user decision before action can be taken

## Entry template

```
### F-NNN: <short title>
- Location: path/to/file.ts:L123 (or multiple paths)
- Found during: <phase / pass>
- Severity: bug | conflict | smell | question
- Description: <what's wrong>
- Proposed resolution: fix-now | defer | needs-user-decision
- Status: open | deferred
```

## Current gate

Build + `tsc --noEmit` green on every commit; `npx eslint` at 0 errors; root vitest + `apps/desktop-ui` vitest + `packages/mcp-server` vitest + `packages/dopl-client` vitest + the desktop suite green.

**⚠ THE WARNING BASELINE IS GONE, and this line used to assert one.** It read "baseline: 2 intentional warnings, `proxy.ts` + `use-boot-state.ts`". Measured 2026-08-08 (`npx eslint src packages apps -f json`): **0 errors and 0 WARNINGS**; `dopl-desktop-app` `npx eslint .` likewise clean. Both trees are at a true zero, so **the next warning to appear is a new one with no baseline to hide in** — do not re-introduce a tolerated-warnings sentence without re-measuring first.

⚠ **THIS TABLE IS AS-OF 2026-08-08 AND IS KNOWN TO BE SUPERSEDED — the 2026-08-10 pass re-measured root at 2733 / 186 files (see the header note), and the 2026-08-11 prune ran nothing at all. Treat every number below as an expired measurement, kept for the shape of the trend and for the "a count that DROPS means a file stopped being collected" rule, not as the current baseline.** The same applies to "Desktop app version on disk" — the repo shipped 1.10.1 on 2026-08-10.

**TEST COUNTS RE-MEASURED 2026-08-08, at the END of the split + fix wave rather than during it.** The previous pass declined to measure — correctly, since agents were still editing — and that declining is itself the thing that expires. Measured after the wave landed, all five green:

| Suite | Tests | Files | Previous (2026-08-05, F-146) |
|---|---|---|---|
| root `npx vitest run` | **2664** | 180 | 2150 |
| `apps/desktop-ui` | **177** | 27 | not tracked |
| `dopl-desktop-app` `npm test` | **2521** | — | 2317 |
| `packages/mcp-server` | **555** | 40 | 483 |
| `packages/dopl-client` | **75** | 4 | 48 |

The SPA suite was absent from the previous baseline entirely, which is its own small version of this file's recurring failure: a suite nobody lists is a suite nobody notices stopping. **A count that DROPS without a deletion in the diff means a file stopped being collected** — check that before trusting a green run.

**Desktop app version on disk: 1.9.1.**

---

## Open findings

### F-016: Legacy slug-only workspace URL fallback awaiting deletion
- Location: `src/features/workspaces/server/segment.ts:68` (`resolveWorkspaceSegmentForUser` legacy branch → `findWorkspaceForMember`); `legacy_slug_redirect` event at `:70-77`. **Line numbers re-measured 2026-08-08 — this entry said `:36` and `:62-64`, both stale after the P0-2 boot-chain work rewrote the file.**
- Found during: workspace publicId rollout (PR #1)
- Severity: smell
- Description: after workspaces moved to `{slug}-{publicId}` URLs, the resolver still falls back to slug-only lookup so pre-migration bookmarks keep working. Each fallback hit logs a `legacy_slug_redirect` system event.
- Proposed resolution: defer — delete the legacy branch once the event drops to zero hits over 14 consecutive days. (`findWorkspaceBySlug`/`findMemberWorkspaceBySlug` have other callers; only the `segment.ts` branch dies.)
- Status: open

### F-017: PublicId rollout skipped for clusters
- Location: `src/features/clusters/**` (4 files, alive); `ontology_clusters`
- Found during: PR #4 scope review (publicId rollout)
- Severity: smell
- Description: workspaces, knowledge bases and skills carry `public_id` (migrations `20260504000000/000100/000200`); neither `clusters` nor `ontology_clusters` does. Re-verified 2026-08-08: ontology clusters DO have a user-facing route (`apps/desktop-ui/src/routes.tsx:55` `ontology/:clusterSlug`), but it is auth-gated and workspace-scoped, so cluster-level publicId still isn't required.
- **Re-scoped 2026-08-08 by the retirement:** WORKFLOW clusters (`features/clusters`, the `clusters` table, `dopl_cluster`) are retired from every surface, so half of this entry now describes a feature no user or agent can reach. Only the ONTOLOGY half could ever matter.
- Proposed resolution: defer — revisit only if ontology cluster URLs ever need to be enumeration-resistant or rename-stable on their own.
- Status: open

### F-023: Effective-access rules encoded twice (pure display fn vs server enforcement)
- Location: `src/features/teams/effective-access.ts:34` (`computeEffectiveAccess`, display) and `src/features/teams/server/access.ts:33` (`effectiveResourceAccess`) / `:112` (`listEffectiveAccess`, enforcement)
- Found during: RBAC consolidation (2026-07-10)
- Severity: conflict (latent drift risk)
- Description: the same rule ladder (admin→edit; workspace-mode→role ceiling; creator→ceiling; else max team grant capped) in two shapes. A forced merge was evaluated and rejected: the server fns early-return specifically to skip team-grant queries, so a shared core would either change query patterns or shrink to a trivial helper. Both file headers cross-reference each other; a rule change must touch both.
- Proposed resolution: defer — revisit if the rules ever change (that is when drift becomes real). Never import `effective-access.ts` from client code.
- Status: open (documented)

### F-026: The web and SPA still pull the whole ontology graph per visit — only the AGENT side got the diet
- Location: `src/features/ontology/server/service.ts:58` (`getSnapshot`, four whole-table pulls, all JSONB); `src/features/ontology/client/api.ts:52` (asks `/api/ontology` with no `view` param); `src/app/api/ontology/route.ts:44` (no param ⇒ `getSnapshot`)
- Found during: ontology cleanup pass (2026-07-10); **re-scoped 2026-08-08 after F-157/F-165**
- Severity: smell (scale)
- Description: **the half that landed** — `ONTOLOGY_READ_LIMITS` (`server/dto.ts:67-72`) now caps all four reads (`repository.ts:56,215,338,394`), `getSummary` exists (`service.ts:118`), and `?view=summary` is a real projection (`route.ts:35-44`). **The half that did not** — the only consumers of `summary` are MCP (`packages/dopl-client/src/ontology.ts:35`, `tools/map.ts:135`, plus the four F-165 call sites). Every human-facing visit still asks for `full`, so the original finding — the whole-graph client model, `attributes`/`methods`/`template`/`layout` shipped per visit — is untouched for the surface a user actually waits on. The whole-graph model is still load-bearing there (instant tab switches, cross-cluster ref editors, an optimistic reducer that assumes a complete graph), so this is not a one-line switch.
- Proposed resolution: defer — the shape is a light cluster index + per-cluster pages + an id→name directory, and F-157's fixture measurement (634 KB → 82 KB on a realistic paid workspace) is the size of the prize. Trigger: a workspace graph large enough that the snapshot is felt.
- Status: open

### F-027: Chat transcripts + chat list are unbounded
- Location: `src/features/chats/server/repository.ts:168-176` (`listMessages`, no `.limit()`), `:42-62` (`listVisibleChats`, no `.limit()`)
- Found during: chats cleanup pass (2026-07-10)
- Severity: smell (scale)
- Description: opening a chat ships the entire transcript including `verbatim`. Measured at decision time: 3 chats / 14 messages. Windowing needs a UI load-more + a full-fetch copy path + an MCP contract decision.
- Proposed resolution: defer — trigger is transcripts reaching real size. Shape then: `GET /api/chats/[chatId]/messages?cursor=&limit=` via `parsePageParams`/`Paginated<T>`; detail returns first page + `messageCount`; copy/MCP fetch full explicitly.
- Status: open

### F-033: `hiddenCount` retention counter is a deliberate approximation
- Location: `src/features/chats/server/repository.ts:70-86` (`countHiddenChats`; the predicate at `:82` is still owner-or-public)
- Found during: chats retention window build (2026-07-16)
- Severity: smell
- Description: the hidden-chats count applies `owner_id = user OR visibility = public` but not the in-memory `canSeeChat` refinements (team-grant membership, API-key private-hiding), so team-scoped-but-ungranted or API-key callers see a slightly inflated "N older chats hidden" strip. Chosen to keep it one cheap head-count query.
- Proposed resolution: if it ever matters, push the grant predicate into the count query.
- Status: open

### F-035: Free-plan chats retention window is app-layer only (owner RLS reads bypass it)
- Location: policy re-created unchanged at `supabase/migrations/20260720211005_rls_pin_workspace_member_and_initplan.sql:624-627` (`chats_owner_select` → `USING (owner_id = (SELECT auth.uid()))`, no retention window); window enforced in `chats/server/{service-reads,retention}.ts`
- Found during: billing adversarial security review (2026-07-16)
- Severity: smell (accepted for v1)
- Description: the 90-day free window is enforced in the service layer (list/detail/MCP), but a chat OWNER can still read their own >90-day rows via direct PostgREST/realtime with their JWT. Deliberately accepted: the window is a monetization gate, not a confidentiality boundary (no data hostage; export must stay possible). Cross-user leakage IS enforced in RLS.
- Proposed resolution: only revisit if the retention gate ever becomes contractual — needs a security-definer read path + removing direct-table SELECT for owners.
- Status: open (accepted)

### F-036: `pick-menu` / `read-pick-menu` / `workflow-bits` are copied from ontology into workflows
- Location: `src/features/workflows/components/{pick-menu,read-pick-menu,workflow-bits}.tsx` vs `src/features/ontology/components/pick-menu.tsx`
- Found during: workflows pivot (2026-07-16)
- Severity: smell
- Description: copied per the §3 no-sideways-imports rule. Promotion trigger: a THIRD consumer appears. Re-verified 2026-08-08 — still exactly two.
- **The trigger is now effectively unreachable, and that is the finding's new shape.** Workflows are retired from every surface (ENGINEERING §7). A retired feature does not grow consumers, so the copies are frozen rather than drifting, and this stops being a promotion decision and becomes part of whatever eventually deletes `features/workflows`. **Do NOT promote to `src/shared/ui` on the strength of a workflows consumer** — that would move code into shared on behalf of a caller nobody can reach.
- Proposed resolution: defer — promote only if a LIVE third consumer appears; otherwise this dies with `features/workflows`.
- Status: open (downgraded)

### F-038: Concurrent-edit protection — version tokens are timestamp strings
- Location: `src/features/skills/server/repository.ts:348` (`.eq("body_updated_at", …)`), `:259` (`.eq("updated_at", …)`); `src/features/knowledge/server/repository-entries.ts:342` (`.eq("updated_at", …)`)
- Found during: 2026-07-17 conflict-system audit
- Severity: smell
- Description: the 2026-07-17 hardening shipped in full (single-flight save chains, no-stomp 412 rebuffer, editor reseed decoupling, EntryView full-entry gating, unmount-412 toast, strict MCP versions, metadata CAS with the threaded metadata clock, presence pagehide untrack). What remains is the design smell only: version tokens are `TIMESTAMPTZ` equality strings, fragile to same-tick writes and serialization drift. A monotonic version counter (or content hash) would be sturdier.
- Proposed resolution: defer — swap the token to a monotonic counter next time the skills/knowledge schema is touched; contract stays the same (opaque token + 412).
- Status: open

### F-040: New-workspace seeding — the partial-retry follow-up
- Location: `src/features/workspaces/server/seed-workspace.ts:62,88,107,119,127` (per-surface catches on a best-effort orchestrator; idempotency key: the `dopl-guide` KB slug)
- Found during: seeding build (2026-07-17)
- Severity: smell
- Description: a partial-seed retry can re-run non-idempotent later surfaces (best-effort contract, low risk).
- **Follow-up (1) DELETED as STALE 2026-08-08:** it said `src/features/configuration/seed-content.ts` is authored but unwired, "wire it when the configuration page moves off mock data". That file no longer exists, and Configuration is retired from every surface, so the condition it waited on can never be met. Follow-ups (2)–(5) were fixed and pruned earlier.
- Proposed resolution: accept unless partial seeds show up in practice.
- Status: open (one follow-up)

### F-042: MCP surface swarm-audit — the surviving follow-ups (2026-07-18)
- Found during: 14-agent consumer-side audit of the whole MCP surface. The batch itself shipped and is documented in ENGINEERING "MCP surface hardening"; only the open items are kept here.
- Severity: mixed
- **Re-verified 2026-08-08 — three of the seven follow-ups are gone, and two of those are STALE rather than fixed:**
  - ~~(2) ontology has no web trash/restore UI~~ — resolved long ago, then made moot by the trash teardown.
  - ~~(3) A2 partial: `opRestoreFolder` / `opRestoreFile` dump the raw code~~ — **STALE.** Both ops are gone from `packages/mcp-server/src` entirely; MCP deletes and restores are now refused at one choke point — **`delete-policy.ts:48,58` (`isBlockedDeleteOp` / `DELETE_REFUSAL`), applied in `gating.ts:195-198`, both moved out of `server.ts` by the 2026-08-08 split.**
  - ~~(4) F-22 unknown-param rejection deferred~~ — **RESOLVED.** `strictInput()` at **`packages/mcp-server/src/registrar.ts:95`, applied at both registration helpers (`:274`, `:306`) — it was `server.ts:370-372/:883/:907` before the 2026-08-08 split**; an unknown key is now `-32602` naming the field. The SDK-strips-unknown-args reasoning this item recorded is out of date.
- **Still open:**
  1. **`proxy.ts` may not be wired as Next middleware.** Re-confirmed 2026-08-08: `src/proxy.ts` exists and there is no `src/middleware.ts`. It IS active (Next 16 renamed `middleware.ts` → `proxy.ts`, and the build manifest lists `ƒ Proxy (Middleware)`) — this item survives only as the warning that a search for the OLD name finds nothing and reports "this project has no middleware layer", which is exactly the mistake F-158 records a hosting audit making.
  5. **F-24 cluster name casing (JUDGMENT).** `normalizeClusterName` (`src/shared/lib/cluster-name.ts:14`, called at `src/features/clusters/server/service.ts:186,240`) forces UPPER_SNAKE. It was load-bearing for the canvas tab — which is retired — so the reason this was KEPT is now gone; revisit if clusters should preserve casing.
  6. **By-id lookups reveal cross-workspace existence.** `assertSameWorkspace` (`src/features/knowledge/server/service-entries.ts:55,105,183`, `path.ts:105`) throws a mismatch error rather than a generic 404 (info oracle; no data crosses).
  7. **Seeded starter skills are read-only to agents** (`src/features/skills/server/service-seed.ts:41` `agentWriteEnabled: false`). Behaviour to confirm, not a bug — flip the seed if agents should edit starter skills.
- Status: open (follow-ups tracked)

### F-044: Billing plan taxonomy v2 — the one open deploy item
- Location: `features/billing/**`, `app/api/billing/{checkout,upgrade-to-team}` — all re-confirmed present 2026-08-08
- Found during: plan-taxonomy rework (2026-07-19)
- Severity: deploy-blocker checklist
- Description: the code, the live Stripe price (`price_1TvDCuPyqrLgRVbyBTPG5ab8`), the taxonomy migration and the 29/29 live smoke all landed. **ONE item remains and it is NOT VERIFIABLE FROM THE REPO** — Vercel env must carry `STRIPE_PRO_SEAT_PRICE_ID` (missing since 2026-07-16) AND `STRIPE_SOLO_PRICE_ID=price_1TvDCuPyqrLgRVbyBTPG5ab8`. There is no env state in the tree, so no future agent can close this by reading code; it is a dashboard check.
- Proposed resolution: Samuel confirms both in the Vercel dashboard before launch.
- Status: open (deploy checklist only)

### F-048: Invite-accept doesn't bind the accepting identity to the invited email
- Location: `src/features/workspaces/server/invitations.ts:267-330` (`acceptInvitationByToken`)
- Found during: audit-fix session (2026-07-20), item M-5
- Severity: question (product decision)
- Description: re-verified line by line 2026-08-08 — the function checks token / revoked / expired / already-accepted / existing membership / seat gate, and **never compares the authenticated user's email to the invitation's `email`.** A forwarded invite link is redeemable by whoever holds it.
- Proposed resolution: needs-user-decision — HELD by owner. If bound: compare at accept time and reject a mismatch (which breaks "invite one address, accept from another", hence a product call).
- Status: open (question)

### F-049: RLS `multiple_permissive_policies` advisor backlog (36 lints)
- Location: Supabase advisor lints; the safe recipe is in the header of migration `20260720211005`
- Found during: audit-fix session (2026-07-20, advisor sweep)
- Severity: smell (scale / perf)
- Description: several permissive policies on one role/action all evaluate. Not a correctness bug. The `auth_rls_initplan` half was RESOLVED and applied 2026-07-20 (advisor 70 → 0). Re-verified 2026-08-08: **35 migrations exist after `20260720211005` and none consolidates a permissive policy**; `20260720211005:724-731` explicitly defers the chats merge and recommends a follow-up migration that was never written.
- Proposed resolution: defer — split each `*_admin_write` / `*_editor_write` `FOR ALL` policy into explicit `FOR INSERT`/`FOR UPDATE`/`FOR DELETE`, leaving the member `FOR SELECT` as the sole SELECT policy; ship behind a no-regression isolation test. Correctness > perf, so this wants a dedicated test-gated pass.
- Status: open (deferred)

### F-051: Older content tables keep `authenticated`+`anon` DML grants (channels-parity revoke pending)
- Location: `chats` / `chat_messages` / `chat_folders`; contrast `supabase/migrations/20260725130000_channels_rls_hardening.sql:43-45`
- Found during: Channels feature build (2026-07-25)
- Severity: smell (defense-in-depth)
- Description: re-verified 2026-08-08 — **no table-level REVOKE on the chats tables exists in any migration.** The only chat REVOKEs are on FUNCTIONS (`20260707190000_chats_hardening.sql:80-81`, `20260718000002_chat_soft_delete.sql:78`). Channels still stand alone. Not a live leak (RLS scopes rows), but the grant surface is broader than needed.
- **This is the same axis as F-102's finding that eight tables are editor-writable straight through PostgREST.** Read them together: a broad grant surface is what makes an app-layer-only bound unreachable.
- Proposed resolution: defer — after confirming no client-direct writes remain, a migration that REVOKEs `authenticated`/`anon` DML on the chats tables + drops their client write policies. Sequence table-by-table; chats first.
- Status: open

### F-053: Channel thread has no backward pagination past the latest page
- Location: `src/features/channels/constants.ts:112` (`MAX_MESSAGE_LIMIT = 200`); `schema.ts:340-350` (`MessageReadQuerySchema` = `since`/`limit`/`thread`, no `before`); `server/repository-messages.ts:60` (only `.gt("seq", since)`); `hooks/use-channel-messages.ts:12`
- Found during: Channels feature build (2026-07-25)
- Severity: smell (scale)
- Description: the thread reads only the most recent messages with no load-older path, so past ~200 messages the older history is unreachable from the UI. The `seq` cursor already drives incremental FORWARD reads.
- Proposed resolution: defer — add a `before=<seq>&limit=` descending page + a load-older control when channel history reaches real size. Same shape as F-027.
- Status: open

### F-055: `dopl_channel` invite/post pre-resolve by scanning `listChannels`
- Location: `packages/mcp-server/src/tools/channel-shared.ts:126` (`resolveChannelOr` → `client.listChannels({ includeArchived: true })`); `packages/dopl-client/src/channel.ts:68` (`getChannel`, wired at `client.ts:592`, zero callers)
- Found during: Channels feature build (2026-07-25)
- Severity: smell
- Description: `read`/`await` are hot pass-throughs and take no extra round trip. `invite`/`post` still scan the whole channel list per write.
- Proposed resolution: defer — give the write ops an id-addressed resolve, or land a `get` op backed by the already-written `getChannel`.
- Status: open

### F-058: No unread / notification surface for Channels outside the Channels page
- Location: unread lives only inside the page (`src/features/channels/components/channels-list-pane.tsx:217,222,288,293`); `src/shared/layout/app-shell/app-sidebar-core.tsx:128-134` badges `consentCount` only — zero `unread` references anywhere under `src/shared/layout/`, and none in the SPA shell
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell
- Description: a member learns about new channel activity only by having the Channels page open, or via the desktop listener's OS notifications. `channel_members.last_read_at` is tracked per membership and is not surfaced in app chrome.
- **Launch-relevant:** Channels is the lead product, and on the desktop app the sidebar is the only always-visible surface.
- Proposed resolution: defer — derive an unread count from `last_read_at` vs the channel's latest `seq` and badge the app-shell sidebar.
- Status: open

### F-059: A request that reaches a machine with no runnable agent is dropped in silence
- Location: `dopl-desktop-app/main/trigger.js:106-108` (the early return + its lone `diag`); the one-shot `cliWarned` notice at `main/channel-listener.js:418-419`
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: bug (dropped request — requester gets no signal)
- **Corrected 2026-08-08 on two counts.** (1) `handleTrigger` is in `main/trigger.js`, not `channel-listener.js` — this entry sent readers to the wrong file for six weeks. (2) The predicate changed: it is no longer `spawner.claudeAvailable()` but `spawner.sessionSpawnAvailable()` (bundled OR external runtime), so the population it hits is smaller. **The shape is identical and still open:** early return, one `diag('trigger skipped: no claude runtime at all…')`, no channel-visible signal, and the cursor has already advanced so it never re-prompts.
- The PRESENCE half shipped 2026-07-26 (`agent_presence` + the desktop heartbeat drive `agentOnline`/`lastSeenAt`, and the composer warns before you send). Presence cannot express **"listening but cannot execute"** — the app is running and heartbeating, so it reads as online.
- Proposed resolution: defer — decide a signal that does not leak local machine state: a terse channel-visible "operator unavailable" once per channel per outage, or a capability flag on the roster beside `agentOnline`.
- Status: open

### F-060: No post RATE LIMIT on channel messages — the size-cap half is closed
- Location: `src/features/channels/constants.ts:136` (`MAX_METADATA_SERIALIZED_BYTES = 16_384`), enforced by the refine at `schema.ts:206-211`; the still-open half is `server/service-writes.ts` (`postMessage`), which has no throttle
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: smell (abuse / scale)
- ✅ **REWRITTEN DOWN TO THE RATE-LIMIT HALF 2026-08-10 — the SIZE CAP LANDED and is verified.** `ChannelMessageCreateSchema.metadata` now carries a `.refine` rejecting anything whose `JSON.stringify` exceeds `MAX_METADATA_SERIALIZED_BYTES` (16 KiB), so the free-form blob is bounded at the same layer that already length-caps `summary`. The cap is a named constant in `constants.ts`, not a literal in the schema, and the constant's own docblock records that the rate-limit half is deliberately still open. Pinned by `schema.test.ts`. **Measured on the serialized form, not the object** — a byte cap on a `z.record` has to be, since the record itself has no size.
- **STILL OPEN, and it is the larger half: there is no rate limit.** No token-bucket, no throttle, nothing per `(user, channel)`. Posts are gated only by channel membership, and each insert takes the per-channel advisory lock, so a hot poster still serializes the channel for everyone else. The size cap bounds one message; it does nothing about a thousand of them. It was left open deliberately — the bucket needs tuning judgement (what rate, surfaced how, and whether an agent's burst is legitimate) that a debt-fix wave should not be inventing.
- **Read with F-100's rate-limit gap:** an OAuth `dopl_at_*` bearer posting straight at the REST route is not rate-limited at the transport either (that limiter lives only in `with-mcp-transport-auth.ts`). Both halves of "unlimited posting" are still live.
- Proposed resolution: defer — token-bucket per `(user, channel)` surfaced as 429.
- Status: open (rate-limit half only; size cap closed 2026-08-10)

### F-061: Workspace admins have no visibility into private channels
- Location: `src/features/channels/server/service-shared.ts:139-149` (`loadVisibleChannel` throws `ChannelNotFoundError` when `visibility !== "public" && membership === null`, with no admin branch); `isWorkspaceAdmin` at `:117` feeds only `canManageChannel` at `:152-157`; `service-reads.ts` `listChannels` inherits the same gate
- Found during: Channels v1.1 adversarial review (2026-07-26)
- Severity: question (governance decision)
- Description: private-channel reads are gated on channel MEMBERSHIP, not workspace role. This is the intentional v1 privacy posture, but it means there is no admin/governance override for compliance, offboarding, or abuse review in a workspace they own.
- Proposed resolution: needs-user-decision — hold. If governance wins over privacy: an audited, role-gated admin read path, or a workspace policy making private channels admin-visible.
- Status: open (question)

### F-063: `onlineMemberCount` costs 2 extra queries on every channel LIST read and is rendered nowhere
- Location: computed at `src/features/channels/server/service-reads.ts:62` from the two extra reads at `:132-133` (`collab.channelMemberUserIds` + `collab.presenceForWorkspace`); the "nothing renders it" note is at `components/channels-view-core.tsx:190`
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell (waste / scale)
- Description: re-confirmed unrendered 2026-08-08 — the only non-test reference in the UI is the comment saying the header derives "N online" from the ROSTER instead. So every channel-list read pays a workspace-wide presence scan plus a per-channel member fan-out for a field with no consumer, growing with members × channels.
- Proposed resolution: defer — drop it from the list DTO (keep it on `getChannel` if a future header wants it), or make it lazy behind `?withPresence=1`. If it is ever rendered in a list it also needs the realtime refetch path the comment currently avoids.
- Status: open

### F-064: Consent expiry is lazy-only — no cron sweep, and an expiring card emits no realtime event
- Location: `src/features/channels/server/consent-service.ts:77,157,170,195` (`collab.expireStalePending` at the top of create / list / get / decide); `vercel.json` `crons` has three entries and none is consent; `CONSENT_TTL_MS = 24h`
- Found during: Channels v1.2 adversarial review (2026-07-26)
- Severity: smell (UX / correctness-at-the-edge)
- Description: a pending request past `expires_at` only flips when the operator's NEXT request runs the lazy sweep. Nothing writes a row at the TTL boundary, so there is no WAL change and no realtime event — the web consent card sits there with live Allow/Deny for up to ~24h. Correctness is preserved (the sweep runs before every read AND before the de-dupe read), but the surface lies while the page is idle.
- Proposed resolution: defer — add `/api/cron/expire-consent`, `CRON_SECRET`-gated, wired in `vercel.json`. **Copy `stale-threads` as the pattern, NOT `purge-trash` — that route was deleted 2026-08-07 with the trash feature.** The resulting UPDATE rides the existing realtime publication, so the card self-clears with no client change. Keep the lazy sweep as the correctness backstop. **The dependency this entry used to carry is GONE, and that changes the cost of the fix: `CRON_SECRET` IS SET since 2026-08-10 (F-133), so a new `/api/cron/expire-consent` would go LIVE on its first deploy rather than sitting inert.** Size the first run before wiring it.
- Status: open

### F-068: Per-channel directory is context + a default, not a filesystem fence
- Location: `dopl-desktop-app/main/channel-dirs.js:9-14` (says so outright), repeated at `:118`; `grep -rn sandbox-exec main/` returns zero hits
- Found during: Channels directory picker (desktop v1.4, 2026-07-27)
- Severity: smell (containment-boundary clarity)
- Description: the per-channel working directory sets the spawn's `cwd` and thus the agent's default root, but is not enforced — an agent with Bash/write tools can `cd ..` or use absolute paths. Actual containment is the tool profile + the two consent gates. Documented as the KEY PRINCIPLE in ENGINEERING §18 so no future session mistakes cwd for a fence.
- Proposed resolution: defer — a true fence needs an OS sandbox (`sandbox-exec`/seatbelt, or a container) wrapping the spawn. Optional hardening on top of the tool profile; revisit if operators point untrusted channels at sensitive directories.
- Status: open

### F-070: Channels v1.5 — the surviving deferred items
- Location: `src/features/channels/server/service-tasks.ts`; `dopl-desktop-app/main/{session-io,settings,session-engine,channel-prefs}.js`
- Found during: Channels v1.5 build + adversarial review (2026-07-27)
- Severity: smell (bundle; item 3 is a product question, not a bug)
- **Re-verified item by item 2026-08-08. Item 1 was already superseded by F-105; item 5 is now RESOLVED and is deleted from this entry.**
  - **2. `set_thread_mode` posts no message, so the web mode badge is realtime-invisible. STILL OPEN.** `server/service-tasks.ts:388-406` does `repoTasks.updateTask` and returns; the docblock at `:383-386` states the intent in its own words ("Posts NO message: the change is intentionally realtime-invisible"). The badge updates only on the next `useChannelThreads` refetch. Desktop is unaffected (mode is stamped fresh at each post).
  - **3. The TARGET can declare `outcome=completed`. PARTIALLY narrowed.** The AGENT lane is now closed — `service-tasks.ts:322` throws `ThreadCloseIsHumanOnlyError` for `ctx.source === "agent"` (class at `server/errors.ts:231`). What is still open is the human half: `:329` authorizes `created_by || target_user_id` and `outcome` is an unconstrained parameter, so the human responder can still mark their own thread `completed`. By design under the workspace-trust posture (same as F-061); a product may later want "responder proposes, requester accepts".
  - **4. Autonomous auto-continuation. PARTIALLY built, and the remaining gap is deliberate.** Mode now gates inbound handling (`main/session-io.js:30`), turn caps exist (`main/settings.js:47` `getTurnCap` → `main/session-engine.js:48`), and resume machinery exists (`session-engine.js:126` → `sessionPark.resumeParked`). **Standing consent is deliberately absent**: `main/channel-prefs.js:15-40` records that the durable channel-wide preset was REMOVED (H2) and replaced with a single-use, expiring, one-consumer arm. Do not "finish" item 4 by re-introducing a durable grant — that reverts a security fix.
  - ~~5. DM revive semantics undocumented in the UI~~ — **RESOLVED.** `components/channel-pane.tsx:466-469` now reads "Your direct message with {peer} will be hidden. Opening it again later brings the history back."
- Proposed resolution: (2) post a lightweight system message on mode change, or have the threads query refetch on the messages-realtime tick; (3) needs-user-decision; (4) next-round feature work.
- Status: open

### F-071: Desktop wake recovery — the manual verification and the undici symbol
- Location: `dopl-desktop-app/main/wake.js:44-53` (the sleep/wake wiring), `main/api.js:79-99` (`resetPool` swapping `globalThis[Symbol.for('undici.globalDispatcher.1')]`, called from `wake.js:50`)
- Found during: Desktop resilience round (2026-07-27)
- Severity: smell (verification + edge-case robustness)
- **Rewritten 2026-08-08: item (b) is STALE.** It described `render-process-gone`/`unresponsive` reloading through the load guard rather than recreating the window. **`main/load-guard.js` is DELETED** (Stage D, and `test/shell-mode.test.mjs:60-61` asserts its absence), so the guard it named does not exist. The surviving handler is `main/session-shell.js:62`, which dispatches `{type:'crash'}` to the reducer for SESSION windows — a different mechanism for a different window. **There is no `unresponsive` handler anywhere in the tree**, which is a real gap but a new one, not the one this entry recorded.
- Still open: **(a)** the "never blank" guarantee leans on Chromium paint-holding and cannot be tested headlessly — it needs one manual pass (close the lid, reopen: loading screen then content within seconds, never black) plus a wifi flip. **(c)** `resetPool` swaps the dispatcher for a fresh instance of its OWN class rather than `require('undici')`; a future Node/Electron that renamed that global symbol would silently no-op it. The per-request AbortController still bounds a dead socket, so the worst case is today's minutes-long recovery, not a hang.
- Proposed resolution: (a) Samuel runs the manual check once against a packaged build; (c) revisit only if wake recovery regresses.
- Status: open

### F-072: 2026-07-27 prod CPU incident — reconnect-storm hardening still deferred
- Location: `src/shared/realtime/shared-channel-registry.ts:132-157` (`scheduleReconnect`) and `:231-236` (the unconditional call on `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`); `dopl-desktop-app/main/presence.js:18` (`HEARTBEAT_MS = 30s`, armed at `:82`, `:94`)
- Found during: prod incident forensics (2026-07-27)
- Severity: bug (root cause FIXED; hardening deferred)
- Description: the root cause is fixed — `readMessages` no longer bumps `last_read_at` to `now()` on every read (the watermark is content-derived and monotonic at both the service and repository layers), and `channel_tasks` left the realtime publication. **The deferred hardening is still open, re-verified 2026-08-08:**
  - **(a) No reconnect circuit breaker.** `use-workspace-tables-realtime.ts` is a 60-line delegator; the real handler is `shared-channel-registry.ts`, which calls `scheduleReconnect` unconditionally. `scheduleReconnect` caps only the DELAY — there is no K-consecutive-failure stop and no `visibilitychange`/`online` gate. Today's capped 15s backoff × every hook instance × every tab still hammers a degraded DB. **This is the amplification leg of the incident and it is untouched.**
  - **(c) `agent_presence` heartbeat is still 30s.** Consider a coarser interval if presence fan-out ever shows up hot. (ENGINEERING notes `agent_presence` retirement is now unblocked to MEASURE against the `channel_sessions` store.)
  - (b) a periodic churn check alerting on `realtime.subscription` insert-rate spikes — not built.
- Status: open (root cause fixed; hardening deferred)

### F-073: Channels receipts — no delivery/read acknowledgment signal exists
- Location: `src/features/channels/lib/message-receipt.ts:4-5` (states "NO acks, and deliberately NO 'Received'/'Read' status")
- Found during: Channels v1.6 (2026-07-27)
- Severity: smell (product gap, deliberately not faked)
- Description: the receipt line reports only transcript-provable states (Sent, Accepted-working, Replied, terminal echoes). There is no "Received"/"Read" because the responder's desktop never acknowledges delivery, and fabricating one would lie to the sender. A real ack must respect F-072: per-message ack writes would recreate WAL fan-out on a realtime-subscribed table.
- Proposed resolution: defer — a coarse per-channel "listener saw up to seq N" watermark, written at most once per poll cycle and monotonic like `last_read_at`, or piggybacked on an existing write.
- Status: open

### F-078: Session Window (v1.9) — the surviving residuals
- Location: `dopl-desktop-app/main/{session-reducer,session-profiles,session-gate-reason,session-effects,tool-profiles}.js`
- Found during: v1.9 Session Window build + 2 security reviews (2026-07-28)
- Severity: smell (none blocks the feature)
- **Re-verified item by item 2026-08-08. Two of the six are RESOLVED and are deleted from this entry; one was WRONG about the current code.**
  - ~~"Allow for this task" is tool-NAME scoped~~ — **RESOLVED.** Grants are input-scoped now: `main/session-grant-keys.js:201` (Bash), `:202-205` (web origin), `:206-209` (edit dir), default `:210` `String(toolName)+'#'+shaKey(stableStringify(input))`.
  - ~~BashOutput/KillShell hard-denied while Bash is gated under `full`~~ — **RESOLVED**, and this entry had it backwards relative to F-119: `main/session-profiles.js:94-95` puts them in `SESSION_GATED_WORK_TOOLS`, subtracted from `SESSION_HARD_DENY` at `:96-98`, so under `full` (`:164`) all three follow Bash. Restricted profiles still deny them (`main/tool-profiles.js:186`), which is correct.
  - **Turn cap counts SDK `result` events, not tool calls. STILL OPEN.** `main/session-reducer.js:224` → `:229` `state.turns + 1` → cap at `:237`. 24 USER-TURNS, not 24 actions; one turn can hold many tool calls. Consider an action budget.
  - **Own-channel post addressed by SLUG gates instead of auto-allowing. STILL OPEN (by design).** `main/session-profiles.js:206-212` compares `input.channel` against the channel ID only; `main/session-gate-reason.js:69-76` classifies a slug-addressed own-channel post as `cross-channel-post`. Safe direction, minor friction.
  - **Subagent gating inheritance never proven. STILL OPEN, and it is unprovable by construction today.** `Task`/`Agent`/`Task*` are in `main/tool-profiles.js:189` `DENIED_BUILTINS` and survive the `SESSION_GATED_WORK_TOOLS` subtraction, so they are hard-denied even under `full`. Untested-but-blocked. **If delegation is ever re-enabled it MUST first be proven that a subagent inherits `canUseTool` + `settingSources` + `disallowedTools`.**
  - **Silent-end cards. PARTIALLY closed.** Operator End / turn cap / cost cap now DO post a calm lifecycle echo (`main/session-effects.js:57-59`). **Idle timeout still posts nothing** — `session-effects.js:26` ("Idle never reaches here; it PARKS instead"), `main/session-reducer.js:380` — so the requester's web card can read "active" for a parked session.
- Proposed resolution: defer all; revisit the action budget alongside the autonomous-continuation hardening.
- Status: open

### F-079: Server-side DM auto-address + task inheritance — residuals
- Location: `src/features/channels/server/service-writes-metadata.ts:399` (`resolveDirectPeer` → `repo.listMembers` at `:107`), `:443` (`resolveInheritableTask` → `repoTasks.listTasksByChannel` at `:126`), `:105` (the `is_direct` bail)
- Found during: cross-user DM delivery-bug fix (2026-07-29)
- Severity: smell (the delivery bug itself is fixed)
- Description: all three residuals re-verified STILL OPEN 2026-08-08.
  - **Two extra reads per DM post.** `listMembers` on every direct post except `intent === "chat"`, plus `listTasksByChannel` when no caller taskId resolved. Both indexed single-channel reads; neither runs for a non-direct channel. Cheapest fix: carry the peer + open-thread set on the already-loaded channel context.
  - **~~`notify_scope='none'` no longer mutes an agent-authored DM ask.~~ MOOT 2026-08-08 (F-170).** Notify scope is removed from the product, so `classify` reads no preference at all and nothing mutes ANY ask, agent-authored or not. The residual's closing sentence survives it and is now the whole of the matter: a per-channel "quiet DM" preference would need its own design. This residual's `targeting.js:240,248` line references are dead — see F-170 for what replaced them.
  - **Inheritance is direct-channel only.** In a 3+ member channel an untagged reply lands untagged, so a session reply there must pass `thread=<id>` explicitly.
- Proposed resolution: defer all three; revisit the read cost alongside F-063, which touches the same path.
- Status: open

### F-080: Desktop Tier 1 security round (contract v2.9 §C) — residuals
- Location: `dopl-desktop-app/main/{mcp-config,tool-profiles,sdk-loader,session-profiles}.js`
- Found during: contract v2.9 Tier 1 fixes C1-C7 (2026-07-30)
- Severity: smell (the shipped fixes close the primary paths)
- Description: all four residuals re-verified 2026-08-08.
  - **(i) STILL OPEN — the HEADLESS/CLI spawn path keeps the plaintext `mcp-spawn.json`.** `main/mcp-config.js:107-140` still writes `Authorization: Bearer ${token}` at mode 600 only, and `main/tool-profiles.js:252-266` `buildRestrictionArgs` returns `[]` for `full` (`:254`) and emits no path-deny for any profile. So a headless spawn's pre-approved `Read` can open it. **Fix shape: thread `extraDenyRules` (the same rules `sdk-loader.buildSecretPathDenyRules()` builds) into `buildRestrictionArgs` + `writeScopedSettings`, and emit `--disallowedTools` for `full` too.**
  - **(ii) PARTIAL — the rules now NAME Grep/Glob but enforcement is still unproven.** `main/sdk-loader.js:104` `SECRET_TOOLS = ['Read','Grep','Glob']`, applied at `:117`; the docblock at `:101-103` still concedes "an unrecognized rule is a harmless no-op on this CLI". SDK path only (`main/session-query.js:43`), not the CLI/headless spawn.
  - **(iii) STILL OPEN — a permissive tool mode can read the credential dirs via the shell.** `Bash` is in `SESSION_GATED_WORK_TOOLS` (`main/session-profiles.js:94`), so under `full` + `bypass` (`BYPASS_TOOLS` at `:348`) it auto-runs, and the deny rules cover only Read/Grep/Glob.
  - **(iv) STILL OPEN — safeStorage-unavailable fallback.** `main/mcp-config.js:47` `DT_KEY_PLAIN`, written unencrypted at `:193`, read at `:207`.
- Proposed resolution: defer; do the headless deny-rule threading with the next spawner pass. **(i) is the one with a real blast radius — it is the 90-day device token in cleartext behind a tool the operator may have pre-approved.**
- Status: open

### F-081: Channels vocabulary v3.0 — the server lane and the storage migration
- Location: `src/features/channels/server/service-tasks.ts` (whole file), `server/dto.ts` (`mapTaskRow`, used at `service-tasks.ts:187,280,379,405,439`), `schema.ts:233` (`TaskCreateSchema`), `server/service-reads.ts:337` (`listChannelTasks`), `server/errors.ts:99` (`TaskNotFoundError`); `channel_tasks` table
- Found during: contract v3.0 Track B (2026-07-30)
- Severity: smell
- **Re-verified 2026-08-08; the AGENT-FACING half is closed and is deleted from this entry.** `dopl-desktop-app/main/prompt-framing.js:298` and `main/prompt-framing-text.js:30` now teach `thread=<id>`; the old `task=<id>` survives only inside FIX S1 comments explaining its removal. **That half was the one that had a functional cost** — the prompt taught a parameter that does not exist, so the whole thread-tagging fix was inert on the primary window-mode path. **The lesson stands and is the reason to keep this entry: prompt/description text that names a tool argument IS API surface.**
- Still open:
  - **The server lane speaks `task` throughout** while everything above it speaks `thread`, so a reader crossing from `client/api.ts` into `server/service-tasks.ts` changes vocabulary mid-call-stack. Intentional (that lane speaks to storage) and marked with boundary comments — but it is a real comprehension cost.
  - **The storage migration is unwritten.** Zero occurrences of `channel_threads` in `supabase/migrations/` or `src/`. `channel_tasks` → `channel_threads` plus the `metadata.task*` keys is the real fix. **Sequence it with F-083's `create_thread` dedup**, since both rewrite the same insert path.
  - `X-MCP-Tool` telemetry labels split across old and new names at the cutover date; a future analytics query must union both. No consumer reads them yet.
- Status: open

### F-083: Channels server audit round (B1-B4) — residuals
- Location: `src/features/channels/server/{service-tasks,repository-tasks,service-writes-metadata,service-writes-metadata-thread}.ts`
- Found during: six-agent audit server lane (2026-07-30)
- Severity: smell (all four original bugs are fixed)
- Description: all four residuals re-verified STILL OPEN 2026-08-08.
  - **`create_thread` with NO `client_msg_id` has no dedup at all.** The lookup is inside `if (input.clientMsgId)` (`service-tasks.ts:239-245`); with none, `:249` inserts unconditionally, so a retry creates a SECOND thread and the abandoned row stays behind with no message. Real fix is a PL/pgSQL RPC or a server-derived key — **sequence with F-081's storage migration.**
  - **A `client_msg_id` collision from another member returns THEIR thread DTO.** `repository-tasks.ts:39-52` `findTaskByClientId` filters `(channel_id, client_msg_id)` only, and `convergeOnThread` (`service-tasks.ts:177-188`) returns `mapTaskRow(task)` for a non-creator — leaking that thread's title/creator/target. Probe-only in practice (keys are caller-chosen UUIDs). Fix: scope the lookup by `created_by` and let a foreign hit fall through to the insert's 23505.
  - **A thread with `target_user_id = NULL` is writable only by its creator.** Still nullable (`supabase/migrations/20260727150000_channel_tasks.sql:20`, `ON DELETE SET NULL`); `isThreadParticipant` (`service-writes-metadata-thread.ts:34-39`) is `created_by === userId || target_user_id === userId`. Mitigated for NEW rows — `TaskCreateSchema.toUserId` is required (`schema.ts:237`) — but the `ON DELETE SET NULL` means a deleted user can still produce one.
  - **`isLegacyThreadParticipant` costs one extra read** (`service-writes-metadata-thread.ts:56-71`, `findMessageBySeq` at `:68`, called at `service-writes-metadata.ts:430`) — only on a post carrying a calm flag AND a legacy id.
- Status: open

### F-085: A signed-out machine still leaves a live bearer in the operator's own CLI config
- Location: `dopl-desktop-app/main/mcp-config.js:247-253` (the deliberate carve-out)
- Found during: Q5 adversarial review (2026-07-31), item S2
- Severity: bug (security; the main path is closed)
- **Rewritten down to the residual 2026-08-08 — the body landed and is verified.** `DELETE /api/auth/mcp-device-token` exists (`src/app/api/auth/mcp-device-token/route.ts:78`, calling `revokeDeviceTokens` at `:101`; exported from `src/shared/auth/mcp-oauth.ts:306`), and `signOut()` calls it FIRST, before clearing the cookie jar the route authenticates on.
- **Re-verified 2026-08-10, and one correction: `revokeDeviceToken()` is FOUR-valued, not three.** This entry said `'revoked'`/`'none'`/`'failed'` and omitted **`'no-match'`** (`main/mcp-config.js:357` — a 200 that matched no row, which the route returns idempotently and which was the COMMON case for already-installed machines; see ENGINEERING §"the revoke verdict is FOUR-valued", which had it right). Returns are at `mcp-config.js:322` `'none'`, `:337,342,365` `'failed'`, `:357` `'no-match'`, `:361` `'revoked'`. The call is at `auth-state.js:271`, inside a `try/catch` that defaults to `'failed'` and falls through to `blob.clearSession()` at `:275` — **fail-open, as intended**: a revoke that cannot be reached must not strand the operator signed in. **No code was written for F-085 in the 2026-08-10 wave** — this line is a doc correction only.
- **The residual, deliberate:** the user-scope `dopl` entry in the CLI's own `~/.claude.json` still carries the bearer after sign-out. `ensureMcpConfig` only ADDS that entry when it was confirmed absent, so an entry that exists may be one the operator wrote with their own credential and is indistinguishable from ours from outside. Deleting a hand-made global config entry is a worse failure than leaving a bearer the revoke has already killed (it 401s, and the next sign-in refreshes it). Not worth a 25s child process on a click that must feel instant.
- Status: open (residual, accepted — recorded so nobody re-discovers it as a hole)

### F-091: The realtime wake ships a whole `channel_messages` row to deliver ~36 bytes of signal
- Location: the `supabase_realtime` publication on `public.channel_messages` (joined whole by the loop at `supabase/migrations/20260725120000_channels.sql:247`); `dopl-desktop-app/main/realtime.js:238-239` (`wakeChannelId`), `:101-103`
- Found during: Q8 egress diet (2026-07-31)
- Severity: smell (pure waste; F-072 blast radius, since every published byte is a byte a read-triggered write would multiply)
- Description: re-verified 2026-08-08 — **no migration narrows any publication to a column list** (`grep "ADD TABLE .*("` → zero hits), and `main/realtime.js` still extracts only `channel_id`. The desktop's push transport is deliberately WAKE-ONLY and the web's handler takes no arguments, yet every INSERT fans out the full row (prod average 881 bytes, max 4,468) plus per-column type metadata, to every subscriber in the workspace, to communicate one uuid.
- Proposed resolution: needs-user-decision — a publication column list is the whole fix and it is prod DDL. **Land it as a migration**, the way `20260807000000` and `20260807100000` did for the publication trims:

```sql
-- ALTER PUBLICATION ... SET TABLE replaces the ENTIRE table list, so the
-- DROP + ADD pair is the only correct way to change ONE table's column list.
BEGIN;
ALTER PUBLICATION supabase_realtime DROP TABLE public.channel_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.channel_messages
  (id, channel_id, workspace_id, seq, created_at);
COMMIT;
-- Rollback: DROP TABLE then ADD TABLE with no column list.
```

- Why exactly those five (verified against prod 2026-07-31): `id` is the primary key and the table is `REPLICA IDENTITY DEFAULT`, so Postgres REQUIRES the replica identity in any column list publishing UPDATE/DELETE; `workspace_id` is the subscription `filter` both clients use AND an input to `channel_messages_member_select`; `channel_id` is the wake routing key and the policy's other input. `seq` + `created_at` are ~60 bytes kept for diagnosis. Dropping `body` + `metadata` is where the win is (~1.6 KB → ~0.6 KB per insert per subscriber).
- ⚠ **The replica identity is ALREADY `USING INDEX (workspace_id, id)`** — applied to production 2026-08-07 (F-156, resolved and deleted in the 2026-08-11 prune; the rationale lives permanently in `supabase/migrations/20260807150000_replica_identity_for_hard_deletes.sql`). So a column list here must include BOTH of those columns, which the block above already does. This is a constraint to respect, no longer an ordering to arrange.
- **Verify after applying — do not skip. Realtime evaluates RLS against the WAL record, and a policy input that stopped being published fails CLOSED (silently no wakes).** Start the desktop with `DOPL_WAKE_BYTES=1`, post one message, confirm `listener.log` shows `realtime insert … bytes=` roughly a third of its previous value, the web transcript still live-updates, and `wakes=` keeps advancing. If wakes stop, roll back — no app deploy is involved either way.
- Status: open (SQL not applied)

### F-092: The 60s client abort was a TRANSPORT choice — two residuals
- Location: `src/app/api/mcp/route.ts` (the `enableJsonResponse` absence + its explanatory comment at `:150-151`, wrapped at `:195`), `src/shared/api/sse-keep-alive.ts`, `dopl-desktop-app/main/mcp-config.js:73,131,498`
- Found during: Q9 (2026-07-31)
- Severity: was HIGH; now smell + two residuals
- Description: every long MCP call died at exactly 60.0s because `enableJsonResponse: true` made the SDK withhold the entire response — headers included — until the handler returned, turning a 60s time-to-headers bound into a 60s whole-call bound. Dropping it means headers flush at t≈0. **Code state re-confirmed 2026-08-08**: no `enableJsonResponse` in the route, pinned by `src/shared/api/sse-keep-alive.test.ts:175`.
- **Residual 1 — NOT VERIFIED AGAINST PRODUCTION.** Verified by unit test and by reading the SDK, never against Vercel. Two things must hold there and were not observed: headers really do flush before the first body byte, and nothing imposes a post-headers idle timeout under ~215s. **Verify on the next deploy with a real long `op="await"` from a terminal Claude Code session with NO per-server `timeout` set** — that is the configuration the fix exists for. Fallback is the per-server `timeout` path, already in place for the desktop's own entries.
- **Residual 2 — per-server `timeout` blast radius.** `MCP_CLIENT_TIMEOUT_MS = 290_000` (`main/mcp-config.js:73`, written as `timeout:` at `:131`) applies to EVERY call to the `dopl` server, not just `await`: a genuinely hung short op hangs a session for ~290s instead of 60s. Accepted — the hold is the only op that can legitimately take minutes. **If Residual 1 is confirmed in production, consider dropping the per-server timeouts entirely rather than keeping two mechanisms.** (`test/mcp-client-timeout.test.mjs` pins the RELATION `AWAIT_HOLD_CAP_MS + AWAIT_HOLD_MARGIN_MS <= CLIENT_TIMEOUT_MS`, not a literal.)
- Status: open (residuals 1-2)

### F-093: The §2 file-size backlog — RE-MEASURED 2026-08-10 (four over cap)
- Location: `eslint.config.mjs` (the rule at `:34-39`, the exemption list); `docs/ENGINEERING.md` §2
- Found during: production-hardening batch 1 (item L1); **absorbs F-153, deleted this pass as superseded** — the same way this entry absorbed F-041 on 2026-07-31.
- Severity: smell (process); the lint half is real drift
- **RE-MEASURED AGAIN 2026-08-08, at the END of the split wave. THE BACKLOG HALVED: FIVE files are over the 500-line cap and `eslint.config.mjs` exempts exactly those five.** `find` + `wc -l` over `src/**`, `packages/*/src/**` and `apps/*/src/**` in one pass. No unlisted file has crossed 500, so the cap is still holding on new code. **This is the first remeasure in this entry's history where EVERY departure was a SPLIT** — the four previous reductions were all deletions (trash teardown ×2, hand-rolled optimistic state, a lint-only file), and a deletion closes a row without teaching anything about how to close the next one.

**RE-MEASURED AGAIN 2026-08-10 (C-20 wave). THE BACKLOG IS FOUR, and `eslint.config.mjs` exempts exactly those four — verified row-for-row in one `find` + `wc -l` pass, not read off the note above.** Third consecutive remeasure where the backlog SHRANK, and the second consecutive one where the departure was a **real split**. **One correction to the table below, in the direction this entry keeps predicting:** `src/shared/supabase/types.ts` is **2934**, not the 2793 recorded on 2026-08-08 — it drifts with every `gen types` and no measurement of it survives a schema wave, which is why its `eslint.config.mjs` comment says "~2934 (drifts with every gen)" rather than a number to be trusted. This wave added four migrations, so it moved.

| File | 2026-08-10 | Note |
|---|---|---|
| `src/shared/supabase/types.ts` | **2934** (was 2793) | Exempt by §2 carve-out — generated; drifts with every `gen types`, do not quote it |
| `src/features/knowledge/server/seed-fixtures-data.ts` | 670 | Exempt by §2 carve-out — pure data |
| `src/features/billing/components/upgrade-modal.tsx` | 570 | Split scheduled — **now the oldest un-split row in the table** |
| `src/features/billing/server/webhook-handler.test.ts` | 542 | Split by event kind |

**`src/features/workspaces/server/invitations.ts` LEFT THE TABLE ON 2026-08-10 (C-20): 534 → 404, and its exemption was DELETED, not moved** — the `plans-billing.tsx` precedent for the fourth time. This is worth more than a row change because of *why* it split. F-041 scoped this split as "extract the accept/join sub-flows" and nobody did it for three weeks; what actually moved it was a **behavioural requirement landing on the file** — C-20 made `removeMember` responsible for what a departure costs inside `channels`, which is a different reason-to-change from minting and redeeming an invite. The seam was `membership-admin.ts` (209: `updateMemberRole`, `removeMember`, `countActiveOwners`), which is **not** the seam F-041 named. The original keeps a two-name re-export so no importer moved. **The generalizable part: a split scheduled on line count waits; a split scheduled by a new reason-to-change happens the same day.** §2 asks for the second and this table mostly records the first.

**FIVE ROWS LEFT ON 2026-08-08, with their siblings measured in the same pass:**

| Was | Now | Split into |
|---|---|---|
| `packages/mcp-server/src/server.ts` 1045 | **227** | `registrar.ts` 313 · `gating.ts` 216 · `workspace-directory.ts` 174 · `instructions.ts` 173 · `meta-tools.ts` 150 · `status-footer.ts` 97. The four gates kept their topology exactly; `parity-harness.ts` followed the constants to `gating.ts` because it parses the CONSTANT, not the filename |
| `src/features/channels/lib/group-thread.test.ts` 983 | **282** | `-status` 421 · `-pairs` 338 · `-reopen` 235 · `-render` 107 (plus two pre-existing `group-thread-*.test.ts`: seven test files in that directory now, not four) |
| `packages/dopl-client/src/client.ts` 720 | **34** | ten-link `client-<domain>.ts` chain + three new transport modules (`workflows.ts` 186, `workspaces.ts` 70, `clusters.ts` 66). ⚠ `client-surface.test.ts` pins 85 methods — **the POST-teardown surface, not the pre-split one.** HEAD declared 92; the seven trash methods left in a SEPARATE change that landed in the same working tree. Two edits, one diff |
| `src/features/teams/server/repository.ts` 625 | **114** | `repository-grants.ts` 229 · `repository-resources.ts` 189 · `repository-members.ts` 149; original kept as the `teams` rows plus a **mandatory** re-export barrel (5 cross-feature importers + a `vi.mock` target). New coverage: `repository-resources.test.ts` 204, `repository-tables.test.ts` 284 |
| `src/features/channels/lib/group-thread.ts` 819 | **428** | `-markers` 176 · `-render` 162 · `-types` 131 · `-draft` 127; the grouping state machine kept WHOLE per §2's reducer carve-out, all public names re-exported so no importer changed |

- **`src/shared/auth/mcp-oauth.ts` is 498 and deliberately NOT exempted** — unchanged, two lines of headroom. Its stale "sits at EXACTLY 500" comment has been corrected in `eslint.config.mjs`.
- **THE DESKTOP CLUSTER GOT WORSE WHILE THE WEB TREE GOT BETTER — FOUR files at exactly 500 now, not three:** `main/ui-sync.js`, `main/session-profiles.js`, `main/session-engine.js`, and **`main/session-reducer.js`, which this entry recorded at 496 and is at the cap** — plus `test/session-chrome.test.mjs` at 500. **A file at 500 cannot absorb a COMMENT**, so all five need a split before they can be *documented*. That is not hypothetical: the `doplToolsPolicy` correction (F-179) belonged in `session-profiles.js` and had to be written in `sdk-loader.js` instead. The desktop config has the same rule at the same severity and **no exemptions at all**; only `renderer/app/**` is ignored. The one over-cap file in either tree is `renderer/session/session.css` at 1064, which nothing lints.
- **⚠ A NUMBER THIS ENTRY PUBLISHED WAS UNREPRODUCIBLE.** It said `test/ui-sync-tables.test.mjs` "is 496 … four lines from the cap". **It is 359** (248 at HEAD, so it did grow — but 496 was never a measurement). A number nobody can reproduce is worse than none: it retires a file from the reader's watch list while looking like diligence. Also corrected against a full re-measure: `main/channel-listener.js` is **493** not 494, and **`main/consent-watcher.js` at 492 was missing from every previous band**. Separately, **eight `test/*.mjs` files sit within eleven lines of the cap** (499 down to 489) and not one had been named here.
- **The extraction-then-drift pattern, re-measured:** `main/targeting.js` 395 → **424**, `main/trigger.js` 394 → **439**, `main/session-reducer.js` 496 → **500**. An extraction buys headroom; it does not buy a habit.
- Proposed resolution: refactor the list one file at a time, outside a hardening round. **The web tree just proved this works when a wave actually does it** — `server.ts`, this entry's standing "first, on reach" pick, went 1045 → 227. Consider making the exemption a size CEILING rather than an off switch. **DO NOT ADD TO THE EXEMPTION LIST — split the file instead.**
- Status: open (rule holding; **5-file backlog, down from 10**; the desktop cluster is now the worse half)

### F-096: Stale prose still describes the deleted `main/mcp-cli-entry.js` as live — and it SHIPS
- Location: `packages/mcp-server/src/tools/channel-await-budget.ts:71`, its byte-identical committed build output `packages/mcp-server/dist/tools/channel-await-budget.js:74` and `.d.ts:69`, and `src/app/api/mcp/route.ts:171`
- Found during: Q9 follow-up (2026-07-31)
- Severity: smell (prose that ships as part of the server)
- Description: `main/mcp-cli-entry.js` rewrote the operator's own `~/.claude.json` — a file holding their `oauthAccount` credential block — to add a per-server `timeout`. Deleted 2026-07-31 for four reasons recorded in ENGINEERING §18. **The module is confirmed absent** and `dopl-desktop-app/test/sdk-mcp-token.test.mjs:264` asserts it. What remains is prose describing it as live, in one source file plus its `dist/` twins, which ship with the SERVER.
- **Line numbers re-measured 2026-08-08 (all four had drifted).** Other surviving mentions are DELIBERATE and must not be "cleaned up": `dopl-desktop-app/main/mcp-config.js:13` and `main/mcp-cli-add.js:11` explain the removal; `test/sdk-mcp-token.test.mjs:251,257,260,264` assert it; `docs/ENGINEERING.md:567` records the reasoning.
- Proposed resolution: fix-now — one sentence in `channel-await-budget.ts` plus one in the route, then `npm run build:packages`.
- Status: open (prose only; rides the next build + push)

### F-097: `POST` and `DELETE` on `/api/auth/mcp-device-token` disagree about an invalid `label`
- Location: `src/app/api/auth/mcp-device-token/route.ts:24-32` (`readLabel`) vs `:87-92` (`RevokeSchema.safeParse`)
- Found during: the revoke-verdict fix (2026-07-31)
- Severity: smell (a label the mint rewrote can never be revoked by the client that sent it)
- Description: both schemas are the identical `z.string().trim().min(1).max(120).optional()` (`:21`, `:74`) — **the disagreement is purely in the handling.** `readLabel` does `if (parsed.success && parsed.data.label) return …` and otherwise falls through to `return "Dopl Desktop CLI"` at `:31`, so a failed parse is SILENT; `RevokeSchema` 400s on the same input. A hostname long enough to push the label past 120 chars is minted under the default and then un-revokable by label, which is the only selector the client has.
- Proposed resolution: fix-now — reconcile: either both coerce or both reject. Rejecting is the honest one; the mint should not silently rename the caller's credential.
- Status: open (server-side; needs a push)

### F-098: The web consent card cannot name the tool profile that actually bounds the session
- Location: `src/features/channels/types.ts:327-351` (`ChannelConsentRequest` carries no profile field); `src/features/channels/components/consent-card.tsx` (zero references to a profile)
- Found during: Q5 review (2026-07-31)
- Severity: smell (copy that gestures at a bound it cannot state)
- Description: under a `read_only` or `dopl_only` profile the SDK's `disallowedTools` plus the credential-path deny rules fence the session at the tool-binding layer, where no permission axis can reach. The COPY half was fixed (`components/permission-preset-row.tsx:52` reads "Auto approving every command the tool profile allows", carried verbatim into `renderer/session/session-labels.js` and pinned in both suites). **The plumbing half was not.** Note the correction this entry already carries: the channel MEMBERSHIP preference IS plumbed (`types.ts` `AgentToolProfile`/`myAgentToolProfile`, `server/dto.ts`, `server/service-reads.ts`, `constants.ts` `AGENT_TOOL_PROFILE_LABELS`, rendered by `components/channel-settings-popover.tsx`) — it is the CONSENT REQUEST that has none, so the card can say "the tool profile" and not WHICH one.
- Proposed resolution: fix-now — plumb the profile onto the consent-request DTO so the card states the real blast radius. The desktop status strip already names it via `permissionPostureText(toolMode, messageMode, profileLabel)`.
- Status: open (needs a server push)

### F-100: The WEB roster still shows every member's EMAIL to every member — the MCP half is closed, the web DTO is not
- Location: `packages/mcp-server/src/tools/channel-render.ts:412-416` (`formatMemberLine`, the closed half, kept as the shape to copy); the OPEN half is the web roster — `src/features/members/types.ts:28,46` carry `email` on the member shapes and `components/member-row.tsx:88,95-97` renders it **unconditionally for every member**, with no admin-or-self test anywhere on the path; the parity comment is `packages/mcp-server/src/tools/members.ts:176`
- Found during: the N-party wave review (2026-07-31); **rewritten down 2026-08-11 — the MCP half verified closed on disk and deleted from this entry**
- Severity: question (owner call)
- **The closed half, kept in one sentence because it is the shape the open half should copy:** `formatMemberLine` computes `emailAllowed = callerIsAdmin || isSelf`; every other member renders as name + id + role, a name-less member renders **by id alone**, and `isAdmin` defaults to `false` at every hop so a boot ping that failed to resolve the flag scrubs rather than leaks. Pinned by `channel-addressing.test.ts`.
- ⚠ **OPEN, and it is a deliberate asymmetry that somebody has to either close or ratify.** The MCP surface is now strictly TIGHTER than web. That was accepted at the time — the agent is the better enumerator and was the actual finding — but the two rosters no longer render the same workspace the same way. **Closing the gap means the same admin-or-self scrub on the web `/members` DTO.** Until someone does it, do not "restore parity" by loosening the MCP side.
- **The enumeration itself is UNCHANGED and that was deliberate.** `listChannels` still ORs `visibility.eq.public` (`src/features/channels/server/repository.ts:48`), so an agent can still walk every public channel and list who is in it; it just cannot harvest the PII. The second proposed resolution — gate `op="members"` on membership rather than visibility — was not taken.
- Two standing rules from the same round, both still correct and worth keeping: **the implicit-trigger rule keys on MEMBER COUNT, not `is_direct`** (one home, `packages/mcp-server/src/tools/channel-addressing.ts`), and **a threaded post must WAIT, not re-post** — telling an agent "nobody was woken, re-post with `to=`" manufactures a duplicate request, which is the 1.7.14 incident shape.
- Proposed resolution: needs-user-decision — scrub the web DTO to admin-or-self, or ratify the asymmetry in writing.
- Status: open (web roster DTO unscrubbed)

### F-101: Narration is a `dopl_*` rule, not a `dopl_channel` rule — one residual, and one decision now disputed
- Location: `packages/mcp-server/src/tools/narration.ts` (the SOLE definition — `neutralizeInline` at `:45`; `channel-shared.ts:56` only re-exports it); `packages/mcp-server/src/tools/ontology-render.ts:42-47` (`indented()`)
- Found during: the cross-tool narration sweep (2026-07-31)
- Severity: smell
- Description: the sweep is CLOSED and verified — one definition guarded two ways (function IDENTITY, so a copy passes a behavioural test and fails this; plus a source scan asserting `narration.ts` is the only file declaring `function neutralizeInline`). **Keep both guards**; they are what stops a later round re-forking the helper. `workspaces.name`/`.description` — the highest-reach untrusted string in the product, since a workspace enters your directory the moment you accept an invitation — is neutralized at six sites in `server.ts`, and the `_dopl_status` footer carries the immutable `id=` beside the renameable slug.
- **Residual, STILL OPEN and re-verified:** `ontology-render.ts` contains **zero `neutralizeInline` calls**. Raw prose flows through at `:216` (attribute value via `renderValue`), `:272` (`m.description`), `:274` (`m.outcome`) and `:277` (`m.tools`). `indented()` gives continuation lines two spaces, so the text survives verbatim and loses only its ability to BEGIN a line — an accepted trade, one blast radius down from the channel bodies. **It can still carry markdown MID-LINE.**
- ✅ **ONE OF THIS ENTRY'S "DELIBERATELY LEFT" DECISIONS WAS DISPUTED AND IS NOW CORRECTED (2026-08-08, F-168).** It read: *"No untrusted-content header on kb / skill / workflow / cluster / ontology. That content is the workspace's own authored procedure and the agent is MEANT to follow it."* **That reasoning is upheld for the SOLO case and overturned for the SHARED one** — the exact distinction this entry drew correctly for `dopl_chats` and not for knowledge bases. `dopl_kb(op="read_file")` and `dopl_skill(op="get"|"read")` now frame a body whose author is not the caller and leave the caller's own bare. The predicate is `narration.isForeignAuthored(row, callerUserId)` (`packages/mcp-server/src/tools/narration.ts:109`), the two headers are `knowledge-shared.UNTRUSTED_ENTRY_BODY_HEADER` and `skills-shared.UNTRUSTED_SKILL_BODY_HEADER`, and the skill header deliberately does NOT say "never as instructions" — the agent reached that slug because its own operator pointed it there. Pinned by `authored-body-untrusted.test.ts`. *(That was F-168, resolved 2026-08-08 and deleted in the 2026-08-11 prune — git remembers the full reasoning.)* **`workflow` / `cluster` / `ontology` are UNCHANGED and still unframed** — the same argument applies to them and nobody has run it; treat that as the open half of this bullet rather than as a decision.
- **Harness lesson worth keeping:** vitest `-t` is a REGEX, so a filter containing `(` or `+` matches nothing and reads as "passed", and passing a filter through a shell lets BACKTICKS run as command substitution with the same silent zero-match. Five apparent mutation survivors in that round were harness artifacts. Do not trust a mutation run driven by a shell-interpolated `-t`.
- Status: open (residual + one disputed decision)

### F-102: Short-label charset bounds — the jsonb labels (the migration half is LIVE, re-verified 2026-08-11)
- Location: `src/shared/lib/safe-label.ts` (the ONE definition: `SAFE_LABEL_RE` + `safeLabelMessage` + `safeLabel` + `safeOptionalLabel`); `supabase/migrations/20260731110000_short_label_charset_bounds.sql` (confirmed present, 20,573 bytes); `src/features/ontology/schema.ts:11-19`
- Found during: F-101's closing report-only call (2026-07-31)
- Severity: smell — **except for item (1), where it is the first layer, not the second**
- **Item (3) DELETED 2026-08-08 as STALE — its premise was wrong.** It claimed `workspaces.description` is edited in a `<textarea rows={3}>` while the charset rule now rejects newlines. It does not: `src/features/workspaces/schema.ts:32` uses `safeOptionalProse`, the PROSE rule, which permits `\n`/`\t`; only `name` uses `safeLabel` (`:29`). The textareas are correct. (Both components were also renamed to `workspace-settings-form-core.tsx` and `create-workspace-dialog-core.tsx`; `schema.ts:20` still names the two pre-rename filenames — stale prose worth fixing in passing.)
- **Item (1) STILL OPEN, and this is the part that matters.** 14 columns are bounded in zod, but for EIGHT of the twelve tables the DB CHECK is the FIRST layer, not a second one: `authenticated` holds INSERT/UPDATE on all of them **and** each carries a permissive `public` write policy — `clusters_editor_update`, `knowledge_bases_editor_update`, `skills_editor_update`, `workflows_editor_update`, `workflow_steps_editor_update`, `ontology_clusters_editor_update`, `ontology_objects_editor_update`, `teams_admin_write`. **Any workspace editor can PATCH those names straight through PostgREST with the anon key and never touch a route, so the zod bound is unreachable for them.** Only `workspaces`, `chats` and `chat_folders` are service-role-only. Pre-flight against prod returned 0 violations of any kind across all 14 columns, so it adds clean.
- **Item (2) STILL OPEN.** The ontology labels nested in JSONB — `attributes[].label`, `template[].label`, `relationships[].label`, `methods[].name` — render into narration but are not columns. `src/features/ontology/schema.ts:11-19` states they are left alone deliberately. They DO carry zod LENGTH caps (`:34,:40,:45,:54`), so "unbounded" is true of charset only. A CHECK would mean walking a jsonb array on every write, and `ontology_objects` is editor-writable, so a zod-only bound would be the fence-beside-an-open-gate this work exists to close.
- **Trap worth knowing, and this file re-triggered it while being rewritten:** the zero-width / bidi / separator class is `[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]`. **Copying it between tools as LITERAL characters can collapse U+2028..U+202F into an ordinary ASCII space**, turning the class into "matches any name with a space in it" and reporting a whole table as violating. That happened during the original work (false alarm on 7 of 9 workspaces) and it happened AGAIN on 2026-08-08 when this entry was re-typed by hand. **Always write and transport the `\uXXXX` ESCAPE form, never the characters.** The migration stores the escape form and carries a five-assertion sanity check to run before trusting any count.
- **Keep the acceptance half of the test suite.** Narrowing the rule to ASCII fails 126/127 acceptance cases, because a rule rejecting `Müller's Team` or `研究` would be worse than no rule.
- Status: open (jsonb labels only — **the constraint half is LIVE**: `20260808150000_replay_hardening_wave_20260731` created `channels_topic_check` and all 14 `*_charset_check` constraints in production, verified present post-apply; the original `20260731110000` file's "unapplied" framing is history)

### F-104: `dopl_channel`'s `memberRef` drops the caller's id
- Location: `packages/mcp-server/src/tools/channel-render.ts:192-198` (bare `return "you"` at `:193`)
- Found during: live identity-confusion incidents (2026-07-31)
- Severity: smell
- **Rewritten down to the one surviving residual 2026-08-08.** The body — ONE `CallerIdentity` record resolved at boot from the credential that is authorizing the request, rendered by one set of functions — is done and is documented in ENGINEERING §8 "MCP IDENTITY + LOCUS". The second residual is RESOLVED: `src/features/mcp-connect/skill-template.ts` now lists `dopl_search` (`:65`), `dopl_members` (`:67`) and `dopl_channel` (`:70`).
- Open: `memberRef` collapses the caller to the bare literal `"you"` on a message line, dropping the id in that slot. Deliberate there, and the roster prints it — but it is the one place the rule "a name never travels without an id" is relaxed.
- **The load-bearing half of the resolution, restated because a future change could break it silently:** a credential label names where the credential was MINTED, never where the session RUNS; an absent runtime stamp renders `unstamped`, never `external`, because a desktop spawn on an older build is also unstamped; and a peer's MACHINE is stated as not knowable ("do not assert it either way") while a peer's ACCOUNT is decidable by user id.
- Status: open (residual)

### F-105: Nothing ever closes a thread, and three mechanisms that key on thread status degrade as open threads pile up
- Location: `src/features/channels/server/service-tasks.ts` (`closeTask`, the only writer of `status='closed'`); `server/repository-tasks.ts:71-82` (`listTasksByChannel` — no status filter, no limit); `server/service-writes-metadata.ts:135` (`candidates.length === 1`) and `:448` (the `taskMode` stamp, read at `dopl-desktop-app/main/trigger.js:289` and `main/session-dispatch.js:200`); the four copies of the await stop-rule — `packages/mcp-server/src/tools/channel-ops-write.ts:342`, `channel-description.ts:61`, `channel-ops-await.ts:122`, `channel-ops-threads.ts:194`
- Found during: live observation, 2026-07-31 — ONE DM channel holding SIX open threads
- Severity: bug (the accumulation is silent, and past two open threads in a pair it changes ROUTING, not just tidiness)
- **All four surviving consequences re-verified line by line 2026-08-08; every line number in this entry is fresh.**
  1. **The await stop-rule is keyed on a condition a finished exchange never reaches.** All four copies teach "STOP when the thread is closed or failed, or when nothing has come for ~30+ minutes". A completed exchange stays `open`, so the thread half effectively never fires and the agent burns a full ~30-minute timeout per finished exchange, re-arming ~3.5-minute holds against a thread that ended long ago.
  2. **`list_threads` grows without bound and is never ranked.** Every row for the channel, newest first, no status filter, no limit, all rendered under an `N threads` header.
  3. **THE SHARP ONE — DM thread inheritance switches OFF at the second open pair-thread.** `resolveInheritableTask` is deliberately all-or-nothing (a guess would attach the turn to the wrong card and route it to the wrong window). Correct on its own terms — but in the observed six-thread DM every untagged addressed message inherits NOTHING and therefore reads on the peer's machine as a NEW request. **This is not gradual: it flips off at the second open thread and stays off until the extras are closed.**
  4. **A stale `mode` is inherited by whatever runs in the thread next.** A thread left `autonomous` from an earlier test keeps handing `autonomous` to every later session in it.
- **Consequence 5 ("closing is never prompted") is RESOLVED and is deleted from this entry.** Propose-then-confirm shipped 2026-08-04: `service-tasks-propose.proposeTaskClose` gives an agent a terminal act that mutates nothing, `channel-description.ts:46` makes proposing the protocol's own closing instruction ("you never close a thread yourself"), and `/api/cron/stale-threads/route.ts` sweeps 14-day-idle threads posting the same `closeProposed` marker under a colliding `client_msg_id`, so it is one prompt per thread forever. **That mechanism is NO LONGER INERT: `CRON_SECRET` was set 2026-08-10 and the sweep runs daily at 07:00 UTC — but it has produced zero candidates so far and its first non-empty run lands ~2026-08-14. See F-133.** Option (b), a TTL sweep, was considered and declined in that route's own docblock: a cron is further from the human than the agent is, and it would fire on exactly the threads with the least evidence.
- Proposed resolution: needs-user-decision — the remaining mechanisms are **(a)** auto-close on a terminal lifecycle event (cheapest and most precise, but it hands the outcome to the responder, which is F-070 item 3's open question, and today's caps post `task_failed` with `capped:true` while leaving the thread resumable); **(c)** an operator prompt surfacing "N open threads" in the channel pane; **(d)** teach agents to close what they opened. Whatever is chosen, consequence 3 argues for making `resolveInheritableTask`'s all-or-nothing MISS visible — a post that could have inherited but did not is the one moment the pile-up is provable.
- ⚠ **Do NOT read F-109 or F-114 as resolving any part of this.** F-109 gives the requester a TRUE cursor at the moment an exchange ends; F-114 makes closing MEAN something. Neither changes how rarely it happens.
- Status: open (question) — consequences 1-4

### F-106: The await/wake primitive — the four accepted residuals
- Location: `src/features/channels/server/service-await.ts`, `service-reads.ts`, `repository-messages.ts`; `packages/mcp-server/src/tools/channel-wake-guidance.ts`
- Found during: live cross-machine channel work (2026-07-31)
- Severity: smell (all three original bugs are fixed)
- **Rewritten down to the residuals 2026-08-08.** The fixes — `excludeAuthor` on the await stack (always-on for the MCP path, NOT sent by the desktop listener, which needs its own rows); `TaskSelfTargetError` → 400 placed BEFORE the `client_msg_id` short-circuit so a retry cannot be handed the stored dead thread as a success; and `channel-wake-guidance.ts` as the one module deciding what may be claimed — are documented in ENGINEERING §8.
- Residuals, all deliberate and none scheduled:
  - **(a)** `.neq("author_user_id", x)` also drops NULL-author rows (SQL `<> NULL`). No writer produces one today, but `channel_messages.author_user_id` IS nullable — **if system-authored messages are ever added, this filter silently swallows them.**
  - **(b)** The exclusion also drops a SIBLING session on the same account from an MCP await. Intended; it is the one case where "own" and "mine" differ.
  - **(c)** Headless desktop spawns carry the `desktop-session` stamp too, so they get the session-window branch's "replies are fed as new turns" wording, which describes the window path more exactly than a headless `claude -p`. Don't-await is correct for both.
  - **(d)** `post to=self` remains unguarded server-side (the receiving desktop classifies it as noise); the MCP `self_target` arm is unreachable by construction.
- **The rule the fix established, which is the durable part:** a tool must not PROMISE a wake it cannot observe. A stamped runtime is told not to arm at all; an unstamped one gets the honest hold-fact plus the wake as a client conditional.
- Status: open (residuals recorded, not queued)

### F-107: The desktop auth-cookie host check is safe only because APP_HOST is a subdomain
- Location: `dopl-desktop-app/main/auth-cookies.js:48` (`APP_HOST`), `:60-64` (`isOurAuthCookie`), consumers at `:86` and `:128`; `main/config.js:4` (`DOPL_APP_URL || 'https://www.usedopl.com/'`)
- Found during: session-end doc pass (2026-07-31)
- Severity: smell (config-coupled latent hazard; not exploitable at today's configuration)
- Description: the predicate is `String(c.domain||'').replace(/^\./,'') === APP_HOST`. Chromium reports a host-only cookie's domain as the bare host and a DOMAIN cookie's as `.suffix`, so stripping one leading dot and requiring an exact match rejects `.usedopl.com` against today's `www.usedopl.com`. That host check is what pins the jar to our own origin — the name half alone let a sibling subdomain's domain cookie into both readers. **The safety is a property of the CONFIG, not of the check.** Point `DOPL_APP_URL` at the apex and `.usedopl.com` — settable by ANY subdomain — strips to an exact match and passes, so the fence silently widens from one host to every subdomain of the apex, with no test failing and no code changed.
- Proposed resolution: defer — make the check independent of which host it is configured for: reject any cookie whose RAW domain starts with `.` when `APP_HOST` is an apex, or compare host-only and domain cookies on separate branches rather than normalizing them into one string. Assert the invariant with a test that feeds a `.apex` domain cookie against an apex-configured `APP_HOST`.
- Status: open

### F-108: Desktop tests that grep source text pin today's SHAPE, not behaviour
- Location: `dopl-desktop-app/test/` — **re-counted 2026-08-08: 155 `test/*.mjs` files; 83 read a `.js` SOURCE module via `readFileSync`; 50 of those also assert over that text** (`assert.match` / `assert.doesNotMatch` / `.test(SRC)` / `exec(readFileSync(...))`). Highest-value example unchanged: `test/sdk-mcp-token.test.mjs` guards a HIGH security fix by source regex (`:69` `assert.ok(!/readFileSync/.test(LOADER))`, `:115` `assert.match(opts, /disallowedTools: cfg\.disallowedTools\.concat\(buildSecretPathDenyRules\(\)\),/)`).
- Found during: session-end doc pass (2026-07-31)
- Severity: smell (debt marker — nothing is currently broken)
- Description: a regex over source proves a string is present, not that the behaviour it implies happens, so a subtly broken rewrite that keeps the phrasing survives the suite. **The class has produced worked examples in both directions:** `session-preset-start.test.mjs` says in its own header that its previous version regex-matched the reducer's source and was therefore worthless; and F-154's `publicationState()` parser was an ORDER-BLIND source scanner whose one real alarm could never fire. The prior count was "79 of 83 read source, 49 assert"; the population has grown to 155 files and the asserting subset with it.
- Proposed resolution: defer — convert opportunistically, highest-value first (`sdk-mcp-token.test.mjs`, being the one guarding a security fix), when each module is next changed for another reason. **Do NOT schedule a sweep:** a mass rewrite of passing tests buys nothing and risks losing the assertions that are load-bearing.
- Status: open

### F-109: The two-agent information-loss round — the five accepted residuals
- Location: `src/features/channels/**`, `packages/mcp-server/src/tools/channel-ops-await.ts`, `scripts/dopl-channel-wait.sh`, `dopl-desktop-app/main/queued-notice.js`
- Found during: a live two-agent cross-machine stress test (2026-07-31)
- Severity: bug (all six defects fixed)
- **Rewritten down to the residuals 2026-08-08.** The fixes — `?thread=<id>` as a FILTER on the message read (deliberately moving NO read watermark, because the watermark is content-derived and monotonic so a filtered read would mark unrelated older messages seen); `closeTask` returning `{ thread, echoSeq }` as an ADDITIVE ENVELOPE KEY; the corrected `seq` documentation (the identity sequence is on the TABLE, so a channel's seqs are gappy — an agent reading a range as a count concludes it lost messages); and the background-shell wake — are in ENGINEERING §8.
- **One BEHAVIOUR CHANGE worth not re-litigating:** a close whose echo post fails no longer throws; it reports `echoSeq: null`. Every error the close ITSELF raises still throws.
- Residuals:
  - **(a) No index backs the thread filter.** `channel_messages` carries `(channel_id, seq)` and `workspace_id` only — nothing functional on `metadata->>'taskId'` — so a scoped read is a filter over the channel scan. Correct at today's volumes; the fix if channels grow is a functional index, not a schema change.
  - **(b) `await` has no thread filter, and the fact lives in four strings** (`channel-ops-read.ts:125` and `:145`, `channel.ts:78` and `:254`). If a thread-scoped hold is ever built, those four move together or the tool starts lying about itself.
  - **(c) There is still no local queue behind the queued notice.** Pickup rides the peer's resend loop exactly as before; the notice closes the silence, not the latency. **A real deferred retry at the settle site is the follow-up** — both defer sites already know everything a retry would need.
  - **(d) claude.ai connectors remain wake-less.** Scope matrix: desktop woken, terminal-with-background-shell has a real wake, connector has none and cannot have one from here (there is no shell to run the poll in). **Do not read `BACKGROUND_TASK_HINT` as having closed that cell.**
  - (e) ~~the `client.ts` size half is tracked at F-093 (720 lines)~~ — **closed 2026-08-08: `client.ts` is 34**, split into a ten-link method-group chain. See F-093.
- Status: open (residuals recorded, not queued)

### F-110: Multiplayer — the five residuals that outlived the rollback
- Location: `dopl-desktop-app/main/{session-pool,session-spawner,session-store,channel-prefs}.js`; `supabase/migrations/2026073109/10/11*`
- Found during: three adversarial per-lane reviews of the multiplayer wave (2026-07-31)
- Severity: smell
- **Rewritten 2026-08-08. Nine of fourteen residuals are STALE — their subject was deleted by the channels rollback — and two are FIXED; only these five survive, and each was re-read off disk.** (Stale: (a) `isThreadCurator`, (b) add/eject asymmetry, (c) `as_agent` attribution, (e) `join_thread`'s member arm, (f) participant re-seeding — `service-participants.ts` and `repository-participants.ts` are deleted; (h) summoned-shell eviction and (i) dismissed teardown — `channel-agents.js` and `session-team.js` are deleted. Fixed: (d) `to_user_notify` is stripped; (n)'s first half collapsed back to a synchronous check; (m) is moot at 1.9.1.)
  - **(g) `pool.listActive` rows are not round-trippable for agent-keyed sessions.** `main/session-pool.js:71-80` `claim()` stores `{key, channelId, taskId, startedAt}` only, while `slotKey` (`main/session-store.js:50-54`) folds in `agentId`, so `listActive()` rows (`:110-112`) cannot reproduce an agent-keyed `row.key`. **Unreachable by construction today** — there is no producer of an `agentId`, and `listActiveSpawns` has ZERO consumers (`main/session-spawner.js:414` is the re-export itself). **Fix the row shape before anything reads it.**
  - **(j) The `claudeSessions` map is unbounded, and it is the only one left.** `main/session-spawner.js:49` `SESSION_KEY = 'claudeSessions'`, written at `:120`; the only deletion is `clearSessionId` (`:123-130`), called from exactly one retry path (`:354`). `store.pruneRecords` (`main/session-store.js:249-261`) prunes `RECORDS_KEY`, a different key in a different module. **The fix is a retention POLICY, not a guard** — `prunableKeys` deliberately protects records that still hold a resume id, so choosing when to evict decides when a session stops being resumable. Give it the `prunableKeys` treatment: one pure policy, called from `session-engine.init` beside the record prune.
  - **(k) The permission preset is CHANNEL-keyed, so one session can consume another's single-use arm.** `main/channel-prefs.js:148` stores `map[channelId]`, `takeArmFrom` deletes on read at `:155-159`. De-amplified (the multi-agent-in-a-room half went with named agents), leaving the original single-session shape. Re-keying the arm to a SLOT touches the same surface F-119's `adoptsConsent` single-setter pin guards, so it is not a drive-by.
  - **(l) ANSWERED AND CLOSED — the constraints are LIVE.** `20260731090000_profiles_display_name_bounds`, `20260731100000_channels_name_topic_bounds` and `20260731110000_short_label_charset_bounds` had history rows whose objects never existed (a `migration repair --status applied` inserts the row without running the SQL); they were re-created for real by `20260808150000_replay_hardening_wave_20260731`. **Verified against production 2026-08-11 by direct `pg_constraint` introspection**, not by reading a file: `profiles_display_name_check`, the charset-bounded `channels_name_check`, `channels_topic_check` and all 14 `*_charset_check` are present. **`migration list` could never have answered this** — it compares history rows to filenames and executes nothing, which is precisely why this item sat open for three days. Nothing left to check here.
- Status: open (residuals)

### F-111: Two agents in one thread on the AUTO posture have no SHORT bound
- Location: `dopl-desktop-app/main/settings.js:29` (`DEFAULT_TURN_CAP = 24`); no consecutive-exchange limit in `session-profiles.js`, `session-gate.js` or `session-reducer.js`
- Found during: live use of the multiplayer wave (2026-07-31)
- Severity: smell (spend risk)
- **Rewritten 2026-08-08. Seven of fourteen residuals are STALE** — `agent-chips-bar.tsx`, `lib/agent-engagement.ts`, `lib/mention.ts` and `channel-threads.js` are deleted and `toAgent`/`toAgents` are `z.never()`, so (b), (c), (d), (f), (g), (i) and (l) have no subject. **Two more are FIXED** ((a) `to_user_notify` stripped; (j) the bullet ceiling now counts `- ` prefixes). **And (k) is now RESOLVED too:** the second law guard's general form is an executed guard, not a docblock — `packages/mcp-server/src/tools/channel-law.test.ts:242-247` scans `OTHER_SIDE`/`STARTS`/`KEYED` sentences, asserts at `:262-270`, and self-checks at `:272-282`. (It still pins prose only, stated at `:3-11`.)
- **What survives is (h), and named agents dying did not kill it.** A thread is two members, each with their own session, and both postures are the operator's to flip. On the default manual/ask posture every hop needs an operator Accept; with both sides on auto there is no human in the loop and the pair ping-pongs until a PER-SESSION bound stops it — turn cap (24), cost cap, or idle timeout. **Finite, and nothing makes it short.** It is the first place two machines compound the trade the auto posture makes everywhere else.
- **The rule this wave established, which is why the entry is worth keeping at all:** *a sentence must not promise the READER an effect the reader cannot cause.* That is the guard that would have caught four of the six agent-facing lies in that round.
- Proposed resolution: defer — an exchange-level bound (N consecutive machine-to-machine hops with no human turn) rather than a per-session one.
- Status: open

### F-112: A milestone is invisible to EVERY session route
- Location: `dopl-desktop-app/main/session-dispatch.js:111` (`feedLiveSession`), `:224` (`maybeSurfaceRequesterReply`), `:322` (`maybeReopenAddressedThread`); the fourth gate is delegated — `maybeOpenRequesterSession` (`:170`) via `targeting.requesterTaskOpen`, whose first line is `main/targeting.js:371` `if (!m || m.kind !== 'message' || !myId) return false;`
- Found during: the 2026-08-01 two-agent live run; **re-verified 2026-08-08**
- Severity: smell — it was a bug; the fix is deleted and the shape is back one layer down
- **The original defect and its fix are both gone.** `routeAddressedAgent`'s blanket kind refusal, `MILESTONE_KINDS`, and the two lanes that wave built all lived in `main/channel-agents.js`, which is deleted; `listener-messages.js:50-54` records the removal at the point the fourth route used to run.
- **What remains is residual (c), and it is now the WHOLE rule rather than a lane-priority question.** Four gates on `kind === 'message'`, and the milestone lane that used to sit underneath them is gone — so a `task_started`/`task_progress`/`task_finished`/`task_failed` post reaches no session route at all, while the MCP tool description and the desktop's own spawn prompt both instruct every agent to log progress as `kind="task_progress"`. Tracked jointly with F-119 (b), which is the same fact seen from the strip.
- **THE REASONING IS THE LOAD-BEARING PART and is why this entry survives its own fix.** *The product asked for a kind the product then refused to deliver.* It was found by correlating undelivered posts against their `kind` across seq 340-368 of a live run — 100% predictive in both directions — while a green suite of 1,780 tests said nothing, **because every desktop fixture constructed `kind: "message"`.**
- Status: open (residual (c))

### F-113: One agent handle, several concurrent sessions — the stamp names a SLOT, not a run
- Location: `dopl-desktop-app/main/mcp-config.js:122-138` (`spawnConfigBody`), `:117-121`, `:163-176` (`writeSpawnConfig`)
- Found during: the 2026-08-01 two-agent live run
- Severity: smell (the wire-identity gap itself is closed)
- **Rewritten down to the residuals 2026-08-08; both re-verified, and the rollback did not touch either — the stamp is server-side and slot-keyed.**
  - **(a) Only the SDK session path stamps.** `spawnConfigBody(token)` is ONE shared serialization for every headless `--mcp-config` spawn — the only header beyond the bearer is the constant `'X-Dopl-Runtime': 'desktop-session'` (`:134`) — and `writeSpawnConfig` byte-compares, so every headless spawn shares the file. Those posts stamp nothing, which is the correct degradation, not a gap. **Not fixed because a per-spawn stamp means a per-spawn config FILE** — a new surface with its own lifetime and permissions, not a guard.
  - **(c) The stamp names a SLOT, not a run.** Two sequential sessions in the same slot stamp the same value. That is what the incident needed (it distinguishes CONCURRENT slots) but it is not a run id; do not read it as one.
- **The discipline to preserve:** `session_id` is a stamp, not a lock — always stripped from caller metadata, re-stamped only from `X-Dopl-Session-Id`, absent header ⇒ NO KEY, and **it is a hint, never an authorization signal** (any device-token holder can send it; nothing gates on it). Enforcing one live session per agent id was rejected: it breaks the legitimate three-slot design and does nothing for an external CLI passing `as_agent`.
- Status: open (residuals)

### F-114: A closed thread can only be reopened by a human, and an agent has no op to point at
- Location: `src/features/channels/schema.ts:288` (`z.object({ op: z.literal("reopen") })`, documented web-only at `:266`); `server/service-writes-metadata.ts:429-437` (the legacy branch) and `:493`
- Found during: the 2026-08-01 two-agent live run
- Severity: smell (the silent-acceptance bug is fixed)
- **Rewritten down to the residuals 2026-08-08; both re-verified STILL REAL.** The fix — WARN, DO NOT REFUSE, via an additive `threadClosed` envelope key — is documented in ENGINEERING §8. A hard 403 was rejected because it breaks the legitimate "one last word after the close echo" pattern and its only remedy has no MCP counterpart.
  - **(a) `reopen` still has no MCP op**, and it matters MORE than it did. The only mcp-server mention is a comment at `packages/mcp-server/src/tools/channel-post-linkage.ts:58`. That mattered little while nothing closed threads; **F-105's propose-then-confirm means closes now actually happen**, so an agent working a thread a human closed early has no way back in and no op to point at. **Not a drive-by:** the close is deliberately human-only (`ThreadCloseIsHumanOnlyError`), so the reopen's authority is a product call.
  - **(b) A LEGACY thread tag can never warn.** The legacy branch never assigns `task` — it only strips or keeps the tag — so there is no status to read. Correct (it is not a thread, which is the same reason F-115 renders it `ad-hoc`), but it means an ad-hoc exchange has no "this is over" signal at all.
- Status: open (residuals)

### F-115: A synthetic `task-<channel>-<seq>` id is labelled `ad-hoc`, and so is a fabricated one
- Location: `packages/mcp-server/src/tools/channel-render-threads.ts:147` (`isFirstClassThreadId(id) ? "thread" : "ad-hoc"`, the predicate a bare `UUID_RE.test` at `:87-89`); same split at `:194-195`
- Found during: the 2026-08-01 two-agent live run
- Severity: papercut
- **Residual (b) is CLOSED as VERIFIED-ABSENT, which is a distinct verdict from fixed and is worth recording.** It said the web UI "was not audited for the same label defect" and pointed at `src/features/channels/lib/group-thread.ts`. That file was audited on 2026-08-08: it contains no `ad-hoc` label at all and handles legacy ids explicitly (`parseLegacyTaskSeq` at `:175`, `legacySeq` at `:415`, the seq-N backfill at `:711-713`, the B1 legacy trigger backfill at `:760`). **There is no parallel defect** — the residual was a guess about a file nobody had opened, and it stood for a week. (The file was 819 lines; **it is 428 as of 2026-08-08**, split into `-markers` / `-render` / `-types` / `-draft`, so the line references above may have moved — re-grep rather than trusting them. The split is unrelated to this residual's verdict.)
- **Residual (a) STILL OPEN:** the label does not distinguish "the desktop minted this" from "a peer typed this". Both render `ad-hoc`. Correct — neither names a thread row — and the legend printing the id verbatim is the only tell.
- **The mechanism is deliberately untouched and must stay so:** deterministic ids, the server-side strip and the desktop's UUID gate are exactly as they were; only the LABEL changed. `shortRef` prints the trailing SEQ for a synthetic id, because a blind `slice(0,8)` collapses every ad-hoc exchange in a channel onto the same prefix.
- Status: open (residual (a))

### F-116: The F1–F7 review round — three surviving residuals
- Location: `packages/mcp-server/src/tools/channel-render.ts:299`; `packages/dopl-client/src/channel.ts:188`; `src/app/api/mcp/route.ts:82,89` and `dopl-desktop-app/main/sdk-loader.js:181,231`
- Found during: the adversarial review over the F1–F7 wave (2026-08-01)
- Severity: smell
- **Rewritten 2026-08-08. Two residuals no longer apply** ((a) the milestone-cadence release note — the lane that delivered milestones is deleted; (c) the `to_agents` 64-cap measurement — `toAgent`/`toAgents` are `z.never()`). Three re-verified:
  - **(b) `· no thread` prints on a page whose only tags are ad-hoc.** `anyThreaded = messages.some((m) => threadIdOf(m) !== undefined)` counts ANY tag, and `threadTagOf` then prints `· no thread`. Cosmetic; rename to `· untagged` if that file is touched.
  - **(d) `@dopl/client.postMessage` returns `{ threadClosed: false }` where a malformed empty 2xx body once returned `undefined`.** Unreachable (the transport throws on non-2xx first); recorded against the docblock's strict-additivity claim, not as a defect.
  - **(e) `session_id` and `appVersion` never co-occur on one row, so the forensic join is still missing.** `/api/mcp/route.ts` reads only `readRuntimeHeader` (`:82`) and `readSessionIdHeader` (`:89`) and forwards no version; `sdk-loader.js` sets `X-Dopl-Runtime` (`:181`) and `X-Dopl-Session-Id` (`:231`) and no version header. The plumbing exists elsewhere (`src/shared/auth/app-version-header.ts:50`, read at `with-workspace-auth.ts:218`, sent by `main/app-version.js:25`), so this is a wire change on two surfaces, not a guard. **Confirmed real in prod rows during the 2026-08-02 incident**: SDK-lane posts carry `session_id` + `runtime` and no `appVersion`; lifecycle posts carry `appVersion` and no `session_id`.
- Status: open (residuals)

### F-118: ATTENDED HANDOFF — five residuals, every one a consequence of "resolve locally, decide nothing on the server"
- Location: `dopl-desktop-app/main/attended-handoff.js` (348 lines, wired at `main/session-ipc.js:19,187-191`), `main/attended-prompt.js`, `renderer/session/session-attended-ui.js`
- Found during: build + review of the attended-handoff feature (2026-08-02)
- Severity: smell (all five accepted for v1, and each is documented in the source)
- **Re-verified 2026-08-08 — the feature is live and all five residuals hold.**
  - **(a) THE SHARPEST: a handed-off card holds one of `MAX_WINDOWS` (6) slots indefinitely.** `attended-handoff.js:9` — "never spawns, never posts a lifecycle" — so nothing settles the consent card and it keeps counting against the budget (`main/session-engine.js:38`, checked at `:58`). Consent windows are not evictable, so **a day of handoffs can silently stop later desktop cards from raising at all.** Cheap fix when wanted: auto-park the consent window shortly after a successful handoff.
  - **(b)** After a handoff, Deny still reads "Deny" (`renderer/session/session-attended-ui.js:72-73`) and still posts "Request declined" into the thread the attended session is answering.
  - **(c)** Attended state is renderer-local (`main/session-ipc.js:186` — the renderer marks handled-attended on the `{ok}`), so a window reload resurrects an enabled button and a second click opens a second terminal.
  - **(d)** No server PATCH on the handoff path, so the web pending list and the OS notification still show a live Allow — the operator's own second surface can spawn a duplicate Dopl session against the attended thread.
  - **(e)** Later addressed messages still raise their own consent cards while an attended session runs; its `await` picks them up regardless.
- **THE INVARIANT A FUTURE SESSION MUST NOT RELAX: zero peer bytes in the prefill.** An attended session is the operator's personal Claude — full tool set, no Dopl containment — so the template interpolates ONLY three narrowed ids. Peer/channel names were deleted after a reviewer demonstrated injection via a 48-char channel rename. `narrowId` is pinned byte-identical to `prompt-framing.idToken` by differential test.
- **And the measured platform limits, because they are not documented anywhere else:** the `claude-cli://` handler silently drops any URL over **4,096 TOTAL characters** (4,096 delivers, 4,097 vanishes; `openExternal` resolves either way, so there is no error to catch) — the documented 5,000-char `q` cap is unreachable. The `claude://code/new` app route TRUNCATES params at **1,024**, which is worse than dropping: half a procedure still looks whole. Both are pre-flighted.
- Status: open (residuals)

### F-119: THE POSTURE WAVE — four surviving residuals
- Location: `dopl-desktop-app/main/{session-dispatch,session-profiles,session-model,session-engine,settings}.js`
- Found during: operator-reported "bypass doesn't stick / Accept reverts my settings" (2026-08-02)
- Severity: smell
- **Rewritten 2026-08-08. This list has now been assessed FOUR times** — (a) and (d) went MOOT on 2026-08-05 (there is no requester shell; `session-team.js` and `wakeTeamSession` are deleted), (h) was subsumed on 2026-08-06 (route (4) is deleted and the operator's typed create is claimed by route (2), which is the precedent (h) itself cited). Each survivor was re-read off disk:
  - **(b) `task_finished` leaves the requester strip unchanged.** `main/session-dispatch.js:269` — `REQUEST_MILESTONES = { task_started: 'accepted', task_failed: 'declined' }`. The comment above it states the reasoning: a `task_failed` with no `declined` flag is a real error, not a decline, and v1 has no word for it, so the strip holds rather than say the wrong thing. `task_finished` is absent entirely.
  - **(c) is the same fact as F-112 and is tracked there** — four `kind === 'message'` gates in `session-dispatch.js`, now the whole rule rather than a lane-priority question.
  - **(e) `BYPASS_READS`' MCP read tools reach ANY configured server under `full`.** `main/session-profiles.js:342-346` (`ListMcpResources` / `ReadMcpResource`), folded into `BYPASS_TOOLS` at `:348`; under `full` `doplToolsPolicy` is `null` (`:167`), so there is no per-server bound. Reads only.
  - **(f) The model context-window table does not cover every id the CLI can report.** `main/session-model.js:92-106` handles the `[1m]` suffix, an exact table hit and a dated `-\d{8}$` strip; anything else — `-fast`, `-v1` — returns `null` at `:105`, so `:126` emits tokens with no window. Fail-safe: **tokens only, never a made-up percentage.**
  - **(g) Each typed request opens a real window.** `session-dispatch.js:170-177` → `launchRequesterSession` (`main/session-engine.js:419-421`); `getWindowMode()` defaults ON (`main/settings.js:34-37`). Self-inflicted, evictable, N requests = N windows.
- **The blocker this wave's review caught is worth restating, because it is a trap the codebase can re-enter:** the consent arm was keyed to the `(channel, thread)` SLOT and consumed unconditionally by EVERY spawn shape, so a peer-driven parked-shell wake racing a pending armed card started at bypass/auto_both while the real Accept spawned manual/ask. Fixed with `adoptsConsent`, threaded from `launch()`'s own adopt test and pinned as a SINGLE SETTER. Do not add a second setter.
- Status: open (residuals)

### F-120: The reopen route — three residuals, one of them stale
- Location: `dopl-desktop-app/main/session-gate.js:185-189` and `:191-195`; `main/listener-messages.js:112-121`; `main/targeting.js:46-49`
- Found during: Samuel's live Claude-desktop DM test on 1.7.23 (2026-08-02)
- Severity: smell (the second-consent-window bug is fixed by route (6))
- **Re-verified 2026-08-08:**
  - **(a) STILL OPEN — the F13 held queue is memory-only.** `session-gate.js:185-189` says it in its own words: the held queue lives ONLY on the in-memory session object, so an app restart mid-hold loses the card and **the cursor has already moved**, so those messages are silently gone from this machine. Pre-existing; the reopen route is one more path that reaches it.
  - **(b) STILL OPEN — the peer's web card reads "Working…" while the gate holds** (`session-gate.js:191-195`). Needs server-side lifecycle state.
  - **(c) STALE — the `agent-escalation` verdict no longer exists.** `main/targeting.js:46-49` records that nothing stamps `author_agent_id` or `to_agent_id` any more, and `main/listener-messages.js:118-121` says the verdict is unreachable and gone. There is no classification left to precede the reopen route.
- **The design property worth preserving:** route (6) is the ONE post-classify route, and post-classify placement buys the no-collateral guarantee by construction — task-reply/fyi/chat/ignore are dispatched before it can run. A recreate is NOT an adoption: the route never touches the consent-entry arm, which is what keeps the `adoptsConsent` single-setter pin green.
- Status: open (residuals (a) and (b))

### F-123: An intermittently failing app-shell test (~1 in 3 full-suite runs)
- Location: `apps/desktop-ui/src/components/app-shell/app-shell.test.tsx` — "rewrites a stale segment to the canonical one, keeping the page"
- Found during: the 2026-08-03 duplication-consolidation pass (NOT introduced by it)
- Severity: smell (flaky test — the worst kind of green)
- Description: reproduced running only `src/components/app-shell` + `src/routes.test.tsx`, i.e. with zero files from that pass in the run. A load-sensitive `waitFor` on the resolve → `needsRedirect` → navigate chain. **The consolidation entry it was recorded inside is deleted this pass; the flake is not, and a flake nobody owns eventually gets "fixed" by deleting the assertion.**
- ⚠ The P0-2 boot-chain work rewrote `use-workspace-route.ts` and `app-shell.tsx` and added `use-workspace-route.test.tsx`, so re-confirm whether the flake survives before chasing it.
- Proposed resolution: fix-now — make the `waitFor` wait on the navigation itself rather than on elapsed time.
- Status: open

### F-133: `CRON_SECRET` is SET — the three jobs are live and NOT ONE RUN HAS BEEN OBSERVED
- Location: `src/app/api/cron/stale-threads/route.ts:80-92` (the gate, plus the operational-history docblock); the three scheduled jobs in `vercel.json` — `oauth-cleanup`, `reconcile-seats`, `stale-threads`
- Found during: the 2026-08-04 delivery round; **premise REFUTED 2026-08-10, entry rewritten down 2026-08-11**
- Severity: bug (operational) — downgraded: the blocker is gone, the verification is not
- ⚠ **THE OLD TITLE WAS WRONG AND IS KEPT HERE SO NOBODY RE-DERIVES IT.** This entry read *"`CRON_SECRET` is unset, so every cron answers 503"* and that sentence propagated into two `src/**` docblocks, an ENGINEERING §7 bullet, three audit findings, a roadmap row and the KB — everywhere as the reason not to worry about a cron-gated fix. **The secret is set.** Measured 2026-08-10: all three `/api/cron/*` answer **401** unauthenticated where they answered 503. Note the apex `usedopl.com` **307-redirects to `www`**, so a `curl` without `-L` returns 307 and proves neither answer.
- ✅ **The two `src/**` copies the 2026-08-10 pass could not reach (docs-only scope) ARE NOW FIXED** — verified on disk 2026-08-11: `route.ts:83-92` reads "OPERATIONAL HISTORY (secret SET 2026-08-10)" and `route.test.ts:7-9,218-221` both say "until 2026-08-10 … the secret is set now". Nothing in `src/**` still asserts it is unset.
- **WHAT IS ACTUALLY OPEN: nobody has watched a run.** The original resolution had two halves — set the secret, then *confirm one successful run of each of the three jobs*. Only the first half is done. `reconcile-seats` and `oauth-cleanup` have now been executing unattended for a day (seat reconciliation writes billing state; the OAuth reaper deletes rows), and neither has ever been observed succeeding. `stale-threads` runs daily at 07:00 UTC and has been a **no-op by measurement, not by luck** — the pre-apply SELECT returned zero candidates and the oldest open thread is 2026-07-31, so **its first non-empty run lands ~2026-08-14**, three days out, and every prompt it posts is a real message in a real shared transcript that both members see and cannot un-see. `MAX_PER_RUN` caps it at 50.
- **Not verifiable from the repo** — there is no env state and no run history in the tree. It is a dashboard check, like F-044.
- Proposed resolution: Samuel (or anyone with the Vercel log) reads one successful invocation of each of the three jobs and records the date here; **and reads the 07:00 UTC `stale-threads` run on or after 2026-08-14**, which is the first one that can post.
- Status: open (verification only — the blocker is cleared)

### F-141: The channels-rollback later-cleanup migrations — nothing here has been run
- Location: `supabase/migrations/` (none written); `channel_agents`, `channel_task_participants`
- Found during: the channels rollback (2026-08-05); **rewritten down to the cleanup list 2026-08-08**
- Severity: smell (dead schema)
- Description: in dependency order, once the rows are genuinely not wanted. Each is a separate migration and each is Samuel's to run.
  - **(a) `channel_agents.engaged_at` / `engaged_by` and the index on them** — no reader anywhere; the first safe drop.
  - **(b) `channel_task_participants` in full** (table, its workspace-consistency trigger, its RLS policies) — nothing reads it now that `mayWriteThread` is gone.
  - ~~(c) `channel_agents` out of the `supabase_realtime` publication~~ — **DONE AND APPLIED**, by `20260807000000_drop_unbound_tables_from_realtime.sql`. **Verified against production 2026-08-11:** `supabase_realtime` publishes exactly **17** tables and neither `channel_agents`, `clusters` nor any `workflow_*` is among them. *(This closed F-094, which was deleted in the 2026-08-11 prune; its sizing data — `realtime.list_changes` at 2,968,450 calls / 386.6 min — is quoted where it still matters, in F-091.)*
  - **(d) `channel_agents.status`** — the DTO stopped mapping it; only attribution reads the row.
  - **(e) `channel_agents` itself and `channel_messages.metadata.author_agent_id` — LAST, and only once historical attribution stops mattering.** ⚠ **Dropping the table is what finally makes an old agent-authored message ANONYMOUS**, because stored messages resolve the author's display name through it. This is a much heavier decision than (a)–(d) and must not be swept in with them.
- ~~item 4: rebuild `test/live/`~~ — **RESOLVED.** The tier exists again (`dopl-desktop-app/test/live/{api,checks-contract,checks-routes,checks-shared,checks-transport}.js`) and `npm run test:live` is a real script (`package.json:11`). The 2026-08-05 note "STILL OPEN — `test/live/` remains deleted" was true when written and is now false.
- **One residual worth keeping:** `main/ui-sync.js`'s `channel_agents` binding in `SYNC_TABLES` is residue — nothing writes that table and no web hook watches it — but dropping a name is a BEHAVIOUR change with a pinned contract test, so it was annotated in place rather than removed. Sequence it with (c)/(e).
- Status: open

### F-144: Two flagged items from the session-state phase
- Location: `src/features/channels/**`, `dopl-desktop-app/renderer/session/**`
- Found during: rollback plan Phase 5 (2026-08-05); **rewritten down to the flagged items 2026-08-08**
- Severity: question + feature work
- **(b) message-a-session's STEER-MY-OWN.** ⚠ **This item CANNOT be implemented as written — see F-152, which is its full re-derivation.** Every clause of the original ("an external MCP post reaches the server, not a specific renderer window; needs a server→desktop→window route that does not exist") is false. Rewrite it to F-152's sentence and leave it closed until the product call and the gated-vs-ungated call land.
- **(d) `thinking` is still unbuilt, and the reason recorded for it was wrong twice.** It does NOT wait on `includePartialMessages` or on the SDK — the session window already renders a Thinking chip with no stream (`session-chrome.js#thinkingVisible`). It waits on `pillState` gaining an input it does not have: it sees only `{ phase, activity, parked }`, never the transcript.
- **CONSENT POSTURE — flagged for Samuel and still unconfirmed.** Spawn-with-handoff opens a window + agent on the operator's machine from a remote trigger. The bound is the IDENTITY PAIR (`authorUserId === me` AND `taskCreatedBy === me`, which a peer cannot forge) **plus TOKEN CUSTODY**, and it has to be stated as both. Gating the handoff behind a card would buy nothing, because the same window is reachable by claiming the `desktop-session` stamp. The call made was "*I asked Claude to do this* is sufficient — no extra card for the window-open itself", with the diag as the observable signal. **The honest security statement is that a leaked device token is the threat, not a declared handoff.** Confirm before treating it as settled.
- Also: `agent_presence` retirement is now unblocked to MEASURE against the `channel_sessions` store (see F-072 (c)).
- Status: open

### F-145: Dead code left by an applied migration
- Location: `src/features/channels/server/repository-collab.ts` (`listSessionStates`, the `PGRST205` degrade)
- Found during: the rollback review (2026-08-05); **rewritten down to the one item 2026-08-08**
- Severity: smell (dead code that reads as a live guard)
- Description: `listSessionStates` carries a `PGRST205` degrade for the case where the `channel_sessions` table does not exist. The migration `20260805120000_channel_sessions.sql` was applied on 2026-08-06 — the table exists and carries live rows, and `read_sessions` answered 200 in the live harness — so that branch is unreachable. **It is worth deleting rather than leaving:** a degrade path for a missing table is a strong hint to a reader that the table might be missing, which is now false and would slow down the next person debugging that read.
- Status: open

### F-146: `main/ui-sync.js` still binds a table nothing writes
- Location: `dopl-desktop-app/main/ui-sync.js` (`SYNC_TABLES` includes `channel_agents`)
- Found during: the residue pass (2026-08-05); **rewritten down to the one deferred item 2026-08-08**
- Severity: smell
- Description: nothing writes `channel_agents` and no web hook watches it, so the binding is residue. It was NOT dropped because that is a BEHAVIOUR change with a pinned contract test and the pass that found it was comment-only. Sequence with F-141 (c)/(e).
- **The lesson from that pass, which this file has now had to learn twice:** its own "NOT CHANGED, with reasoning" clause said the F-105 / F-110..F-117 residual sets were "assessed and left, because the rollback did not invalidate them". It had invalidated most of them. **"Assessed" was doing work an `ls` would not have supported.** Distrust any status line that reports on a set the writer did not re-read.
- Status: open

### F-150: The knip sweep is MEASURED, not executed
- Location: `knip.json` (ignore list is exactly `[".claude/**", "**/dist/**", "supabase/**", "dopl-desktop-app/**"]`)
- Found during: Stage E part 1 (2026-08-06)
- Severity: smell
- **The matcher half is RESOLVED and is deleted from this entry.** `src/proxy.ts:497-499` excludes exactly `SELF_AUTH_ROUTES` (`:97-111`) — `api/mcp`, `api/oauth`, `api/version`, `api/cron/`, `api/billing/webhook`, `.well-known/oauth-` — plus F-158's additions. `/api/mcp` is the one that matters: it streams, and its correctness rests on headers reaching the client inside a 60s budget.
- **Two things about knip worth recording before anyone runs it again:**
  1. **knip cannot see the desktop tree at all.** Unscoped it reported **339 unused files**, including essentially all of `dopl-desktop-app/main/` — it does not resolve a plain-CommonJS `require` graph from an Electron entry point. **Acting on that output deletes the app.** The tree is in the ignore list; treat any future knip run over it as noise, not debt.
  2. **Scoped to the TS tree the finding is real and bigger than a leaf sweep: 43 unused files, 122 unused exports, 147 unused exported types.** It is a TRANSITIVELY DEAD SUBGRAPH — `shared/layout/app-shell/app-shell.tsx` has two real importers and `features/tour/index.ts` has fourteen, and every one of those importers is itself dead — so it cannot be verified file by file; the closure has to be taken at once. knip's alias resolution was spot-checked and is trustworthy (it flags `app-rail.tsx` while correctly KEEPING `app-rail-core`, which the SPA imports through `@/`), and four probes against the shipped bundle's sourcemaps confirmed none is bundled. `scripts/**` and the vitest shims in that list are false positives.
- ⚠ **The measurement predates the retirement wave, which unrouted three page trees.** Re-run before acting; the dead subgraph is almost certainly larger now.
- Proposed resolution: defer — this belongs with the `@/`-boundary extraction (the 344-module task), not squeezed in beside a window refactor.
- Status: open

### F-152: steer-my-own is not a missing IPC route — it is a missing PRIVATE transport
- Location: `dopl-desktop-app/main/listener-messages.js:66`, `main/session-dispatch.js:112-114`, `main/session-ipc.js:45-46`
- Found during: 2026-08-07, re-deriving F-144 item (b)
- Severity: question (product + security decision)
- **Every claim in this entry was re-verified 2026-08-08 and all three hold; only line numbers moved.** The route EXISTS and is load-bearing today: `listener-messages.js:66` → `sessionDispatch.feedLiveSession` resolves a SPECIFIC window from `(channelId, taskId)` (`session-dispatch.js:113-114` → `hasLiveSession` → `session-engine.js:423-425` `sessions.get(store.slotKey(a))`). The channel long-poll IS the server→desktop transport; `(channelId, taskId)` IS the desktop→window route. The local steer primitive exists too (`session-ipc.js:45-46` `session:send` → `{type:'steer'}`, scoped by `event.sender`). Addressing is solved: `ChannelSessionState` carries `channelId` AND `threadId`.
- **What actually refuses a steer is one conjunct** — `session-dispatch.js:112`, `if (!myUserId || m.authorUserId === myUserId) return false;` — the echo brake. Three refusals in total, all predicates, none of them IPC.
- **THE REAL BLOCKER, AND IT IS SERIOUS: the only transport is a SHARED transcript, and the peer's machine eats the steer.** A steer posted into the thread a session is on is fed as a turn to the COUNTERPARTY's own agent. Verified conjunct by conjunct from the peer's side — their `myUserId` differs from the author, `kind === 'message'`, the `taskId` matches, their responder session is live, `counterpartyFor` returns the author. **It feeds.** And a `metadata.steer` key means nothing to a desktop that predates it, so the sender-side flag cannot ship before a peer-side DROP RULE has been in the field.
- **The value/risk split is bad at both ends.** A GATED steer requires the operator to be at the window they could have typed into — thin value. An UNGATED steer bypasses `feedInbound`'s Accept gate, and under `toolMode: 'bypass'` **one remote post becomes arbitrary tool execution on the operator's Mac with no card and no notification.**
- **On the peer boundary, in fairness: a steer route would NOT weaken it.** `m.authorUserId` is server-derived and unforgeable. The escalation is on the axis F-144 flags as unresolved — TOKEN CUSTODY. Today a `dopl_at_*` holder can open a NEW session, which starts at `manual`/`ask` so every tool call raises a card. **Ungated steer lets the same token inject into an EXISTING session already holding standing grants for a different purpose.** That is strictly more than the flagged status quo.
- What would have to be true: (1) a product call on privacy — a visible steer is one key and one predicate; a private one needs a transport that is not the shared thread, i.e. schema + RLS; (2) regardless, a peer-side drop rule shipped FIRST, then a skew window, then the sender flag; (3) an explicit gated-vs-ungated call, which is a token-custody decision and not an agent's to make.
- Status: **not built, deliberately** — open until (1) and (3) land

### F-155: A non-direct channel's delete is "hidden forever, retained forever", and the copy is waiting on the product call
- Location: `src/features/channels/components/channel-pane.tsx` (the non-DM ConfirmDialog); `server/service-writes.ts#deleteChannel` → `repository.ts:239#softDeleteChannel`; `reviveChannel` at `repository.ts:177`; migration `20260807110000_purge_soft_deleted_rows.sql:48-51`
- Found during: the retirement + hard-delete truthfulness sweep (2026-08-07)
- Severity: question (product decision)
- **Rewritten down to the open half 2026-08-08.** Four of the five items shipped and are verified: the DM copy is back to stating the revive mechanic (`channel-pane.tsx:466-469`), the false comment in `channel-actions-menu.tsx` is corrected, and "Leave channel" and "Remove member" both gained confirmations.
- **Open: a non-direct channel has no revive path and no purge.** Nothing calls `reviveChannel` for it, and the purge migration excludes `channels` wholesale. The honest state is **hidden forever, retained forever**, and the copy therefore claims neither permanence nor recoverability: *"…will be removed from the workspace. This can't be undone from here."*
- ⚠ **Do NOT "resolve" this by picking a side in the copy. The copy is waiting on the product call, not the other way round.**
- ⚠ **Two things a future session must not undo.** The DM copy is REVERSIBLE-by-design and must stay that way while `softDeleteChannel` is what `deleteChannel` calls. And `channel-pane.tsx` is **495 lines** — five from the cap — so the next edit to it is a split, not an addition (§2).
- Status: open (question)

### F-158: `/` stays in the proxy matcher, deliberately
- Location: `src/proxy.ts` `config.matcher`; `next.config.ts` `headers()`; ENGINEERING §9.3
- Found during: launch-readiness P0-4 (2026-08-07)
- Severity: smell (unpriced auth work on the highest-traffic public URL)
- **Rewritten down to the deferred half 2026-08-08.** The matcher fix, the favicon bug (**every signed-out landing visit ran an edge function that 307'd the page's own favicon to `/login`**), the response headers and the OG asset re-encode (1,304,973 → 100,348 bytes, −92.3%) all landed and are verified locally against `next start`.
- **Open, and it needs the landing page's owner.** `/` is the highest-traffic public URL and already `○ Static`, so excluding it would drop a real edge hop. But its only work in the proxy is the signed-in bounce, and **moving that client-side breaks ENGINEERING §9.3 rule 1: `isWebsiteRetired()` must be read PER REQUEST, and a client decision is baked into prerendered HTML at build time.** Because `RETIREMENT_LANDING === WEB_POST_AUTH_LANDING` today the breakage would be invisible until someone flipped `WEBSITE_RETIRED=0` mid-incident. A client bounce also fires only after hydration, so a signed-in visitor paints the whole marketing page first and the browser must re-derive its own session — the per-visit auth work restored one layer up. **`/` is the one path in `next.config.ts`'s `headers()` deliberately left without a `Cache-Control`, for the same reason; it gets one the day it leaves the matcher.**
- **The reason nobody had found the underlying bug, kept because it will recur:** Next 16 renamed `middleware.ts` to `proxy.ts`. An earlier hosting audit searched for the old name, found nothing, and reported that this project has no middleware layer. `src/proxy.ts` is a live auth gate matched on nearly every request.
- **NOT VERIFIED on Vercel** — the edge-invocation saving is only observable on deploy.
- Status: open (deferred half)

### F-159: The write layer — ADOPTED for all four named families; what remains is the layer's own gaps
- Location: `src/shared/hooks/use-api-mutation.ts`; `src/features/{channels,chats,members}/hooks/**`; `src/features/ontology/graph-state.ts`; `src/features/channels/components/channel-transcript.tsx` (`MessageBubble`)
- Found during: launch-readiness P0-1 (2026-08-07)
- Severity: smell (an absent layer, now adopted)
- ✅ **REWRITTEN 2026-08-08: the "~80 remaining sites" scope is DONE.** Every family this entry named is converted. Yesterday's version of this line said "exactly EIGHT `useApiMutationWith` call sites exist, all in three channels hooks" — that was true when written and expired within a day, which is this file's own doctrine about status lines demonstrated on the entry that states it.
  - **chats** — 5/5 writes on the layer, the `useState` copy of query data deleted (it was a second source of truth), reads re-keyed by path, double-submit closed on folder-create-on-Enter and pin/unpin.
  - **members** — 13 writes converted. **F-045 closed with it** (deleted as resolved this pass): `useInvalidateBillingStatus` finally has callers — remove-member and approve-join — so the seat count stops going stale after a membership change.
  - **channels LIFECYCLE** — 5 writes converted, and the header that read "deliberately still on the old await-then-refetch envelope" is gone. **The refetch-coordinator gate is REQUIRED on these**, not optional: the override maps that were incidentally doing the coordinator's job are deleted, so the gate is now the only thing standing between a realtime doorbell and an unsent local change. (Closes CHANNELS-AUDIT C-27 for channels — 5/5 families gated.)
  - **ontology** — creates are optimistic via the reducer + `CREATE_RESOLVE`, **deliberately NOT `useApiMutation`**: the board renders from `graphReducer`, not from a query cache, so there is no cache entry for `optimistic` to patch. The layer is for cache-backed surfaces; a reducer-backed surface implements the same three beats in the reducer. While a row is provisional its id is not addressable and the realtime write gate is held.
- **Four rules the conversions added to §7** (5–8): merge-never-replace when the response is narrower than the cache; a feature's READS must be on `useApiQuery` before its writes adopt the layer (converting writes first yields a feature that looks converted and behaves as before); `CREATE_RESOLVE` for server-minted-id-plus-instant-render; `pendingRow` on a CONTROL is what closes toggle races.
- **Two decisions inside the layer worth keeping.** (1) Invalidation is EXPLICIT, not automatic-per-patched-key. (2) `cancelQueries` skips queries with no data — a FIRST load has nothing for the write to land on, so cancelling one strands the surface empty.
- **OPEN, and it is now the LAYER's debt rather than a site backlog:**
  - ~~`channel-transcript.tsx` still does not dim a pending CHAT bubble.~~ ✅ **CLOSED 2026-08-10.** `MessageBubble` calls `pendingRow(isPendingId(message.id), …)` (`channel-transcript.tsx:225`, off `provisional` at `:186`), so an optimistic chat message now carries the same treatment `SessionCard` already had. Pinned by `channel-transcript.test.tsx`. **⚠ THE TRAP THAT COST TIME: there is NO `message-bubble.tsx`.** `MessageBubble` is a PRIVATE function inside `channel-transcript.tsx` (declared at `:165`, used at `:145`) and is exported from nowhere. A grep for the filename returns nothing and reads as "the component does not exist"; grep for the SYMBOL. This entry's own Location line has always said `channel-transcript.tsx (MessageBubble)` and was right.
  - ~~The cold-cache filter is duplicated (`ifCold` / `coldKeys`).~~ ✅ **CLOSED 2026-08-10** — promoted to `coldKeys` in `use-api-mutation.ts`; see F-178.
  - The layer cannot express a PREDICATE invalidation, which per-item keys actually need — see F-181. **This is now the ONLY layer gap left in this entry.**
- Status: open (one layer gap — the predicate invalidation, F-181)

### F-163: `useApiQuery`'s two remaining option-forwarding follow-ups
- Location: `src/features/channels/components/channels-view-core.tsx:173-184` (`refetchRef`); `src/features/knowledge/client/hooks.ts:68-70` (`initialData: undefined`)
- Found during: launch-readiness P0-2 (2026-08-07)
- Severity: bug (the original was a stated performance policy that was inert app-wide)
- **Rewritten down to the follow-ups 2026-08-08.** The fix landed and is structural rather than an `if`: `buildApiQueryOptions` routes every caller-supplied option through `definedOnly()`, so an option the caller did not name is ABSENT from the object rather than present-and-`undefined`. **The test is `!== undefined`, never truthiness: `0` is not "unset", and an explicit `staleTime: 0` still has to beat the 30s default.**
- **The mechanism, restated because it will catch someone again:** TanStack resolves options by SPREAD, so an explicit `undefined` key WINS over the default rather than falling back to it. `{ staleTime: undefined }` resolves to `undefined`; an omitted key resolves to `30000`.
- **Open follow-up — the channels realtime signal should INVALIDATE the prefix, not refetch the selection.** `refetchRef` refreshes only the SELECTED channel, so non-selected channels' cache entries are never marked stale. `staleTime: 0` on the transcript is the honest fix for that change's scope; `queryClient.invalidateQueries({ queryKey: apiPathKey(...) })` would mark every variant stale and let the 30s default stand for the transcript too. One channels-feature change.
- **Open follow-up — `useKnowledgeQuery` passes `initialData: undefined`** — the same key-present-with-undefined shape. Inert today because no client default sets `initialData`; it becomes live the moment one does.
- Status: open

### F-164: Two boot-chain follow-ups
- Location: `apps/desktop-ui/src/pages/chats/index.tsx:49,56`; `apps/desktop-ui/src/components/settings-modal/settings-modal.tsx:64`; `src/app/api/workspaces/ensure-default/route.ts`
- Found during: launch-readiness P0-2 (2026-08-07)
- Severity: smell
- **Rewritten down to the follow-ups 2026-08-08.** The collapse landed: launch → actionable screen is now `bridge.getAuthState()` (IPC, local, no network) → `POST /api/boot` → the page's own data. 5 round trips → 1.
- **Two details of the client half are load-bearing and must not be "tidied":** `seedBootAnswer` seeds DURING RENDER, not in an effect (React runs child effects first, so `<Navigate>` and the `<Outlet/>` page would each dispatch their own request before a parent effect's seed landed), and it seeds only where nothing is cached, so a live answer is never clobbered by an older boot payload.
- **Open follow-up — `/api/workspaces/ensure-default` now has no runtime caller in this repo.** It stays deployed on purpose: an older shipped DMG still calls it. **Delete it only alongside a minimum-version floor that excludes those builds.**
- **Open follow-up — the chats page and the settings modal still READ `resolve`/`me` directly.** They are free today because boot seeds their keys, but that is a CONVENTION, not a structure — both should move to `useWorkspaceRoute`.
- Status: open

### F-165: `getSnapshot` carries the same read ceilings and reports nothing
- Location: `src/features/ontology/server/service.ts#getSnapshot`; `ONTOLOGY_READ_LIMITS` in `server/dto.ts:67-72`
- Found during: F-157 follow-up (2026-08-07)
- Severity: bug (silent clipping on the detail path)
- **Rewritten down to the open item 2026-08-08.** The four map-shaped MCP reads (`dopl_search`, `op="map"`, `op="resolve"`, the admin cascade count) are switched to `getOntology({ view: "summary" })`, and the three shared resolvers were re-typed to what they actually touch — generically, so a snapshot in still yields `OntologyObject` out.
- **Open: the FULL projection is capped at 500 / 5,000 / 20,000 / 20,000 like the summary but returns no `truncated` flag**, so `op="get"`, `op="anchor"` and every ontology WRITE path are clipped in silence today — **a `resolveObjectRef` miss on a >5,000-object workspace renders as "No object X".** Switching four reads onto the summary did not create this exposure and did not widen it (same ceilings either way); it made four of the surfaces able to admit it. **Not fixed there because `getSnapshot` returning a `truncated` flag changes `OntologySnapshot`, which the board consumes** (the graph view was a second consumer until it was deleted 2026-08-11) — a web-side change with UI consumers.
- ⚠ **`renderObject` and every op in `ontology-ops-write.ts` deliberately KEEP the full snapshot**, and `read-projection.test.ts` §2 pins them to a bare `getOntology()` for that reason. A future pass that "optimizes" those onto the summary is the mistake, not the fix.
- **The distinction the clipped notice draws, worth not collapsing:** a clip is not a per-op CAP (a cap hides matches we found; a clip hides rows we never scanned, so "narrow the query" is never offered for a clip), and a clip is not an ABSENCE ("no matches" is an assertion a clipped read never established). The admin cascade count states its number is **a floor, not the cascade** — the rows past the ceiling are still deleted, they were just never in hand to count.
- Status: open

### F-166: Avatar-cache SSRF — DNS-rebind residual (renumbered from the `F-09x` placeholder, 2026-08-08)
- Location: `dopl-desktop-app/main/avatar-cache.js:56-58` (`isSafeAvatarHost` guards `new URL(url).hostname.toLowerCase()` — a STRING), the concession at `:39-42`, the gate at `:122`, the sole export at `:166`
- Found during: Session Window v2.2 review (2026-07-29)
- Severity: smell (low residual; primary vectors closed)
- ✅ **The dangling `F-09x` reference is FIXED (2026-08-08).** This entry carried the placeholder id for ten days; the renumber pass could not reach outside `docs/` and left `main/avatar-cache.js:42` saying "tracked as residual in F-09x". It now reads `F-166`, verified on disk. **The SSRF residual below is unchanged and still open** — only the pointer was wrong, and a wrong pointer to a live finding is worth its own line because it is the failure that makes a finding unfindable.
- Description: `getDataUri` fetches a member's `profiles.avatar_url` — the only remote-fetch surface in the desktop app. Guards enforced: https-only, `redirect:'error'`, raster `image/*` content-type, declared+actual ≤256KB, 4s timeout, bounded positive+negative cache, and `isSafeAvatarHost` blocking IP-literal + `localhost`/`.local`/`.internal` targets (169.254.169.254 metadata, 127./10./172.16-31./192.168./100.64-127., ::1, fc00::/7, fe80::/10, mapped-v4). **RESIDUAL: a PUBLIC hostname that DNS-rebinds to an internal IP is not caught** — the guard is on the URL host string, not the resolved IP, and there is no resolve-then-check anywhere.
- **Bounded because `avatar_url` is NOT user-settable** (the profile PATCH allowlist excludes it; it comes from Google OAuth), `redirect:'error'` blocks the 302-to-internal bypass, and the fetch is an image-only, no-exfil GET rendered only in the operator's own window as a `data:` URI.
- ⚠ **`main/avatar-policy.js` does NOT close this.** That destination allowlist (`AVATAR_HOST_ALLOWLIST` at `:39-42`) exists for the SPA path only and is required only by `main/ui-bridge.js` and `renderer/app-preload.js`. `avatar-cache`'s own callers — the session window, `resolveForSession` (`main/session-engine.js:352-354`) — still rely on `isSafeAvatarHost` alone. **Do not read the SPA allowlist as having hardened the session-window path.**
- Proposed resolution: defer — if avatar sourcing ever becomes user-influenced, add a resolve-then-check (`dns.lookup` the host, reject a private resolved IP) or extend the `avatar-policy` allowlist to this caller too. Until then the sync literal guard is proportional.
- Status: open

### F-169: Repo-vs-production drift that keeps `db diff` permanently noisy — the replay is DONE, this is what it left behind
- Location: `supabase/migrations/20260416061700_early_supporter_grant.sql` (creates three objects production does not have); the ten comment-only function bodies (identified by the 2026-08-08 two-sided `db diff`, not re-enumerated since)
- Found during: "make migrations replayable from scratch" (2026-08-08); **rewritten down 2026-08-11 after the migration state was re-measured against production**
- Severity: smell (a diff that is never clean trains people to ignore it)
- ✅ **BOTH BIG HALVES ARE DONE and are deleted from this entry** (git remembers). (1) The set replays: the recovered baseline `20260415000000` (2,065 lines) is on disk and tracked, and brought back `handle_new_user()` + `on_auth_user_created`, which existed in **no** migration in the repo; `20260706000000:63` carries the `set_config('storage.allow_delete_query',…)` fix; `20260731100000:73-74` carries its own `DROP CONSTRAINT IF EXISTS` preconditions. (2) **The four "recorded applied but absent from production" hardening migrations of the 2026-07-31 wave were re-created for real by `20260808150000_replay_hardening_wave_20260731`, and that migration is APPLIED.** Re-verified against production 2026-08-11 by direct introspection: `profiles_display_name_check` present, `handle_new_user` carries the sanitising body, `channels_name_check` is the **charset-bounded** definition (not the loose length-only inline one), `channels_topic_check` present, all **14** `*_charset_check` constraints present, `channel_agents_engaged_idx` **gone**. **Local files 157, history rows 157, zero local-only, zero remote-only.**
- ⚠ **OPEN (1): three early-supporter objects exist in the repo and not in production** — re-verified 2026-08-11: `profiles.early_supporter_granted_at` **absent**, `claim_early_supporter_grant()` **absent**. They are missing not because the feature is dead but because they are **credits-feature objects**, removed with the rest of the credits system (`user_credits`, `credit_ledger`, four RPCs) by hand, outside the migration history. Deleting `20260416061700` would strand its history row as a remote-only orphan — the exact class of problem the replay fixed — so the clean resolution is a NEW migration dropping the three objects, a no-op against production. That is a new local-only version and therefore a `migration repair`, which is why it was left.
- ⚠ **OPEN (2): ten functions differ from production in COMMENTS ONLY.** Bodies are byte-identical once comments and blank lines are stripped (verified mechanically, not by eye). Production holds comment-stripped variants — the signature of a body re-saved through the dashboard or `apply_migration` rather than through a migration. Cosmetic, but `db diff` reports them forever until one side is rewritten. **Not re-enumerated since 2026-08-08; treat the count as as-of that date.**
- **THE RULE THIS ENTRY EXISTS TO CARRY, and it earned a second half on 2026-08-11.** (a) `supabase migration list` reported **149 in sync / 0 pending** for four months while the set could not build a database: it compares history ROWS to FILENAMES and never executes anything, and `migration repair --status applied` inserts a row **without running the SQL** — so a version can be recorded while its objects never existed. **The only checks that mean anything are `db reset` (does it build?) and a two-sided `db diff` / direct `pg_constraint` introspection (does prod match?).** (b) The inverse is just as dangerous: **a migration file's own header is authored before the apply and nothing ever updates it.** `20260808150000` opens with `-- UNAPPLIED. DO NOT run without reading this header.` and repeats it at `:76`. It has been applied since 2026-08-09. **A file on disk saying "NOT APPLIED" is not evidence; only the database is.**
- Proposed resolution: defer both — one migration clears (1), and (2) is cosmetic. Do them together the next time anyone wants a clean `db diff`.
- Status: open (two cosmetic drifts; the replay and the hardening wave are both live)

### F-170: Notify scope is REMOVED from the product — and with it the only thing that could ever suppress an implicit trigger (2026-08-08)

- Location (removed): `src/features/channels/components/notify-scope-button.tsx` (deleted), `components/channel-pane.tsx`, `components/channels-view-core.tsx`, `hooks/use-channel-preference-writes.ts`, `lib/optimistic-cache.ts` (`setNotifyScope`), `schema.ts` (`NotifyScopeSchema` + the `ChannelMemberSelfUpdateSchema` field), `packages/dopl-client/src/channel-types.ts`, `packages/mcp-server/src/tools/channel-ops-read.ts` (roster docblock), `dopl-desktop-app/main/targeting.js:240,248`, `dopl-desktop-app/test/{classify.test.mjs,_classify-harness.mjs,classify-rollback.test.mjs,main-audit-targeting.test.mjs}`
- Location (still live, see "Open half"): `src/features/channels/server/{dto.ts,service-reads.ts,service-writes-members.ts,repository.ts}`, `src/features/channels/types.ts`, `dopl-desktop-app/main/trigger.js:73-78`, `channel_members.notify_scope`
- Found during: audit item C-18 → removal, Samuel's explicit decision (2026-08-08)
- Severity: **behaviour change**, not a cleanup. Read the next bullet before assuming this was inert.

**Why it went.** The bell popover offered three choices and two were untrue. `'addressed'` ("Addressed to me only") was compared **nowhere on the trigger path** — byte-identical to `'all'` in `classify`. `'none'` ("Muted / No notifications from this channel") suppressed only the IMPLICIT two-member trigger; an explicitly addressed message still raised consent and spawned a session, so the option labelled "Muted" did not mute the loudest thing a channel does. Both behaviours were **asserted as intended** in `test/classify.test.mjs:85-118`, so the tests encoded the bug and were removed with it.

**⚠ THE BEHAVIOUR CHANGE, stated where nobody can miss it. There is now NO way to suppress an implicit two-member trigger.** `scope === 'none'` at `targeting.js:248` was the only conjunct that could return `'ignore'` there, and it is gone. A two-member channel or DM now ALWAYS prompts on an unaddressed user-authored message. This is the actual consequence, confirmed by reading the branch rather than inferred: the suppression does not move somewhere else and it does not degrade — it ceases to exist. **Samuel may want a replacement.** If so it needs its own design; do not reinstate the column, whose semantics are the defect. The absence is pinned by a test that feeds a stale `myNotifyScope` on the entry and asserts `'trigger'` anyway, so it cannot be re-introduced by accident.

**A correction to the audit, found while tracing.** C-18 says the single runtime read is `targeting.js:240,248`. There is a **second**: `main/trigger.js:73-78` (`sendFyi`) returns early unless the scope is `'all'`. So `'addressed'` was NOT dead everywhere — it silenced every FYI notification, which is the one thing its label half-promised. That read is in a sibling-owned file and is listed below.

**The privacy consideration this removes.** `notify_scope` was one of the two fields `dto.ts:185-210` deliberately nulls for everyone but the viewer — "who muted the channel" was treated as private, and `service-reads.test.ts` pins it. Removing the field removes that consideration. The scrub itself STAYS: `agent_tool_profile` is still under it, so the mapper's invariant and its docblock survive with one subject instead of two. Note that the scrub never held over CDC anyway — `channel_members` is in the realtime publication (audit C-11) — which is an argument for dropping the column, not for keeping the scrub.

**THE DATABASE COLUMN — decision: DROP IT. ✅ Migration `20260808120000` APPLIED 2026-08-09**, after the 1.10.0 code deploy and the desktop floor raise to 1.10.0 (which blocks the 1.9.x builds that still carried the settings write). `src/shared/supabase/types.ts` regenerated in the same change — `notify_scope` is gone from the schema. Original reasoning, kept: The "leaving it costs nothing at runtime" framing is the part that turned out to be false. `sendFyi` still reads it, so with the popover gone **every row already stored as `'none'` or `'addressed'` has its FYI notifications suppressed permanently, with no surface left to change it back** — a stuck state that only a drop (or new UI) clears, since the readers' `?? 'all'` fallbacks take over the moment the column is absent. Dropping also deletes the C-11 CDC exposure by deleting the data, and removes a `CHECK (notify_scope IN ('all','addressed','none'))` that reads as a blueprint for rebuilding exactly the feature that was wrong. Against that: irreversibility, and six migrations went up on 2026-08-07 with the chain repaired twice in two days (F-156, F-167, F-169) — which is why the file is written and **left un-run** for Samuel to schedule rather than pushed. Every read is `select("*")`, so the drop is runtime-safe even ahead of the code; the file states its own ordering anyway.

**Open half — sibling-owned files this pass did not touch.** Two other agents held these directories concurrently, so they are routed rather than edited: (1) `src/features/channels/server/{dto.ts,service-reads.ts,service-writes-members.ts,repository.ts}` still map, scrub and (unreachably) write the field — `updateMemberPrefs`'s `notify_scope` branch is already dead because the schema no longer accepts it; (2) `src/features/channels/types.ts` keeps `NotifyScope`, `Channel.myNotifyScope` and `ChannelMember.notifyScope` **solely because those four server files import them** — delete the type and the build breaks until they go; (3) `dopl-desktop-app/main/trigger.js`'s `sendFyi` read, and the stale comment at `main/targeting-window.js:36`. `src/shared/supabase/types.ts` is generated and should be regenerated when the column actually drops. Until (1)–(3) land, the wire still carries a preference nothing can set.
- Proposed resolution: fix-now for the routed files above (mechanical, no design questions); then apply the migration; then regenerate the DB types. Separately, decide whether a per-channel "quiet here" preference is wanted at all — F-079's surviving sentence asks the same question from the DM end.
- Status: open (UI, client wiring, schema, `classify` and the desktop tests are done; server DTO, `sendFyi` and the column remain)

### F-172: `propose_close` is re-raisable — but the SUCCESS RESPONSE still tells the agent "Do not propose again", and a test pins it there
- Location: **the stale copy** — `packages/mcp-server/src/tools/channel-ops-threads.ts:301` (the `propose_close` success text) and its mirror in the shipped `dist/tools/channel-ops-threads.js:258`; pinned by `packages/mcp-server/src/tools/channel-closed-thread.test.ts:172` (`expect(text).toContain("Do not propose again")`)
- Found during: audit item C-6 → Samuel's decision to make it re-raisable (2026-08-08); **rewritten down 2026-08-11 — the server fix verified, the copy sweep found INCOMPLETE**
- Severity: bug (the fix is defeated at the loudest surface)
- ✅ **The server half is DONE and is deleted from this entry** (git remembers). `closeProposalClientMsgId` keys on (thread, outcome, ACTIVITY ANCHOR) where the anchor is the newest seq in the thread that is not itself a proposal — so a retry dedupes, a genuine re-proposal after more exchange writes a new row, and "keep open with nothing said after it" dedupes correctly. The cron no longer shares the namespace (`stale-swept-${taskId}-${anchor}`). Both client readers were already right and needed no change.
- ⚠ **THE OPEN HALF, and note that this entry's own open-half bullet ENUMERATED THE WRONG SITES.** That bullet named two places teaching the old one-shot rule: `channel-description.ts:68` and a comment at `channel-closed-thread.test.ts:171`. **`channel-description.ts:68` is fixed** — it now reads *"Propose once per STATE of the thread: a repeat with nothing said in between collapses into the prompt they already have, but if they keep it open and the work moves on, propose again when it is done again"*, and `channel-ops-threads.ts:217` (the `close_thread` refusal) carries the same correction. **What the bullet never listed is the one that matters most:** the `propose_close` SUCCESS response, `channel-ops-threads.ts:301`, still ends *"Do not propose again; a repeat collapses into the same prompt."* That is the sentence the agent reads **in-context, immediately after proposing** — strictly louder than a tool description read once at boot — and it flatly contradicts the description. A well-behaved agent still never re-proposes, which is the exact defect this finding was opened for.
- **The test is not a bystander, it is the lock.** `channel-closed-thread.test.ts:172` asserts the stale sentence is present, so fixing the copy turns the suite red and the fix looks like a regression. Invert the assertion in the same change; do not delete it.
- **`dist/` is what the app loads**, so the edit requires `npm run build:packages`. (The description's fix did ship to `dist/` — `dist/tools/channel-description.js` contains "Propose once per STATE" — which is how a half-swept surface passes a spot check.)
- Proposed resolution: fix-now — replace the final sentence of `channel-ops-threads.ts:301` with the `channel-description.ts:68` wording, invert the test assertion, rebuild `dist/`.
- Status: open (one stale sentence + its pinning test)

---

## F-175 — Desktop reliability round: the two field-triggered residuals

- Status: open (two accepted residuals; the round itself is resolved and deleted — git remembers)
- Found during: CHANNELS-AUDIT C-2, C-3, C-4, C-5, C-7, C-8, C-9, C-10, C-11 (2026-08-08). Full statement of the rules is in [ENGINEERING.md §18, "THE RELIABILITY ROUND"](ENGINEERING.md); the round was mutation-proven with nineteen deliberate breakages and shipped `main/consent-store.js`, `main/quit-guard.js` and eight new test files, all verified present on disk 2026-08-11.
- Severity: smell (both are judgment calls awaiting field evidence, not defects)

- **`escape` on the quit dialog means "wait", not "cancel".** Verified on disk: `main/quit-guard.js:111-113` — `buttons: ['Quit anyway', 'Wait for them to finish']`, `cancelId: BUTTON_WAIT`. With exactly two buttons (Samuel's call), the cancel id is the non-destructive one, so **escaping a quit prompt starts the wait rather than abandoning the quit**. The wait announces itself and a second Quit re-opens the dialog, but there is no "never mind" button. Revisit if that reads wrong in use.
- **A machine with no Claude Code runtime retries 8 times per inbound before dropping it.** That is the C-3 ladder doing its job — the condition can be transient (an asar unpack race) — but on a genuinely runtime-less install it costs ~4 minutes of held cursor per trigger message. The escape is logged; a startup-level short-circuit is the cheaper answer if it shows up in the field.
- Proposed resolution: defer both; each has a concrete trigger (an operator complaining about the quit dialog; a runtime-less install in the wild).

---

## F-177 — `full` means full: the one surviving conditional

- Status: open (one conditional follow-up; the round itself is resolved and deleted — git remembers)
- Found during: the two spawn lanes disagreeing about `full` (2026-08-08). Full statement of the rules is in [ENGINEERING.md §18, "`full` MEANS FULL"](ENGINEERING.md). Verified on disk 2026-08-11: `main/session-profiles.js:99` is literally `const SESSION_HARD_DENY = UNIVERSAL_HARD_DENY.slice();` and `main/sdk-loader.js:190` carries `alwaysLoad: true` on the dopl MCP entry.
- Severity: smell (a conditional, not a defect)

- **`alwaysLoad` was added to the SDK lane only.** The headless `--mcp-config` file (`main/mcp-config.js`) is compared as exact bytes, and headless `full` is already documented as MCP-limited (no `--allowedTools` means non-pre-approved tools auto-deny with no TTY), so the field buys nothing there today. **Add it if the headless lane ever pre-approves dopl tools under `full`.**
- **A note that is NOT debt, kept because it is the argument someone will re-open:** an approved `Task`/`Agent` is an approval of everything the subagent then does — it does not inherit this session's `canUseTool` bound. That was FIX H3's case for the old split, and F-177 answered it with the operator's click rather than with the tool table, because the same session can already run `Bash`. If it ever needs a stronger answer, the place is an `AgentDefinition` with its own `disallowedTools`, not a return to the split.
- **DELETED AS STALE 2026-08-11 — this entry's third open item.** It read: *"`buildMcpServers` passes `doplToolsPolicy` as an array of STRINGS, while the SDK types `McpHttpServerConfig.tools` as `McpServerToolPolicy[]` … if the string form is ignored at runtime, that layer is inert and should be re-shaped."* **The field is no longer sent at all** — F-179 established that the string form was not ignored, it caused the CLI to drop the whole server entry, and the assignment was removed (`sdk-loader.js:216` now records where it stood). The item describes code that does not exist.
- Proposed resolution: defer — conditional on the headless lane changing.

---

## F-178 — The M4 stale-roster gate is unpinned at the component boundary

- Location: `src/features/channels/components/message-composer.tsx:57,109,140` (`membersStale` prop → `rosterStale` on the draft) and `components/channel-pane.tsx:53,111,419` (the prop's only path); the pure half is pinned in `lib/composer-mode.ts:111,134,190,217,262`
- Found during: adversarial review of the channels mutation layer (2026-08-08); **rewritten down 2026-08-11 — both other halves verified closed on disk and deleted**
- Severity: smell (a real gate with no test standing behind its wiring)
- ✅ **Deleted as resolved from this entry** (git remembers): H1, the cold-transcript send — `coldKeys` is promoted to `src/shared/hooks/use-api-mutation.ts:121` and `ifCold` returns **zero hits anywhere in `src/`**, so the duplicate cannot be revived by name. And the M4 gate itself, which exists and works.
- ⚠ **OPEN: the gate's COMPONENT wiring is unpinned, and deleting the prop chain would fail nothing.** `buildComposerPayload`'s refusal and its help line are pinned pure, but `membersStale` → `rosterStale` runs through `MessageComposer`, whose request mode cannot be reached in the root suite (no DOM; the mode is internal `useState` and the pill needs a click). **Verified 2026-08-11: `apps/desktop-ui/src/features/channels/` — the jsdom home named for this — contains four test files and NONE of them mentions `membersStale`, `rosterStale` or "Loading who's in this channel…".** So the prop is load-bearing and untested end to end: a refactor that drops `membersStale={membersStale}` at `channel-pane.tsx:419` reintroduces the bug (switch to a DM, send a REQUEST immediately → correct channel id, previous channel's peer, 400 `ChannelAddresseeNotMemberError` after the optimistic paint) with a green suite.
- **The rule that made the pure half testable, kept because it is why the gate is ordered the way it is:** `rosterStale` is checked BEFORE the target resolves, so the help line cannot name the wrong person. Chat is deliberately not gated — it reads no roster.
- Proposed resolution: fix-now (small) — one jsdom test in `apps/desktop-ui/src/features/channels/` that mounts the composer in request mode with a stale roster and asserts the disabled send + "Loading who's in this channel…".
- Status: open

---

## F-180 — `reconcile-seats` returns raw Stripe exception text on its 200 path

- Location: `src/app/api/cron/reconcile-seats/route.ts:108-116` (`failures` built from `result.reason.message`), `:140` (into `system_events.metadata`), `:144` (into the response body)
- Found during: the error-sanitizer sweep (F-179's sibling wave), auditing what the sweep deliberately did NOT convert
- Severity: smell (information exposure, low reach)
- Description: the sanitizer sweep put 39 files / 44 error tails onto `toHttpErrorResponse`. **This is the named residual, and it is invisible to that sweep by construction**: the route never throws. Per-workspace isolation is deliberate and correct — one workspace's Stripe error must not abort the sweep — so failures are COLLECTED and the route returns **200** with `{ok:true, scanned, succeeded, failed, failures}`. `failures[].error` is `result.reason.message` verbatim: raw Stripe SDK text, which can name internal ids, plan/price identifiers and API-version detail. The same string is written to `system_events.metadata` (capped at 50 entries).
- **Bounded, which is why it is a smell and not a bug:** the route is `requireCronSecret`-gated (fail-closed 503 when unset), so the only reader of the body is the scheduler. The durable copy in `system_events` is the more interesting half — that is a workspace-readable analytics surface in a way a cron response is not.
- Proposed resolution: fix-now (small) — map to a stable reason code per workspace and keep the raw text on `console.error` only, which is what the same route already does at `:117`. **Do not "fix" it by making the route throw** — the isolation is the design.
- Status: open

---

## F-181 — The mutation layer cannot express a PREDICATE invalidation, and `setResourceScope` is where that first costs something

- Location: `src/features/members/hooks/use-access-writes.ts:156-161` (`setResourceScopeConfig.invalidate` names `teams` only); contrast `:106-108` (`setGrantConfig`, which enumerates `draft.memberIds`)
- Found during: adversarial review of the members conversion
- Severity: smell (a layer limitation, surfaced by one call site)
- Description: §7 rule 1 records that a per-item key cannot be reached by a prefix — TanStack matches per ARRAY element, so `[…/members]` invalidates no `[…/members/<id>/access]` entry. `setGrantConfig` answers that by NAMING each id, captured at submit. **`setResourceScopeConfig` cannot use the same answer**: flipping a resource into or out of teams mode changes what EVERY member's per-member access pane says, and the write has no member list to enumerate — there is no `memberIds` on a `ResourceScopeDraft` and no bound on how many members a workspace has.
- **So the hazard is two-sided and neither side is currently taken.** Enumerating every member is an unbounded invalidation (the thing rule 1 exists to prevent — a fan-out proportional to roster size on a single toggle); naming only `teams` leaves per-member panes stale, which is the F-045-shaped staleness the same wave just closed elsewhere. Today it does the second.
- **The real gap is in the layer**: `invalidate` returns a list of KEYS. TanStack's own `invalidateQueries` accepts a `predicate`, which is exactly what "every `…/members/*/access` entry" needs, and `use-api-mutation.ts` has no way to pass one.
- Proposed resolution: fix-now on the layer — let `invalidate` return a predicate alongside keys, then use it here.
- ⚠ **The "land it with F-178's promotion" instruction is STALE as of 2026-08-10 and is removed.** That promotion shipped without this: `coldKeys` now lives in `use-api-mutation.ts` and `ifCold` is gone. **F-181 stands alone** — it is the last of the layer's own gaps (F-159's open list is down to this one item). The two were the same SHAPE of debt and touched the same file, which is why they were bundled; that was a convenience, not a dependency, and nothing about the predicate work is blocked or made easier by what landed.
- Status: open (unblocked; no longer bundled with anything)

---

## F-182 — An `autoGrant` retry writes grants on OTHER teams, whose members' access panes are never invalidated

- Location: `src/features/members/hooks/use-access-writes.ts:90-108` — `invalidate` adds `teamsKey` when `draft.autoGrant`, then enumerates `draft.memberIds` (this team's members only)
- Found during: adversarial review of the members conversion
- Severity: smell
- Description: the config's own comment states the mechanism and stops one step short of the consequence: *"an autoGrant asks the SERVER to write additional grants on OTHER teams to satisfy the KB invariant, and those are the rows no client can guess."* It invalidates the teams cache for that reason — but the rows the server wrote belong to members of the CONFLICT teams, and `draft.memberIds` is the acting team's roster. Those members' `…/members/<id>/access` panes keep rendering the pre-grant answer until something else refreshes them, and the pane does not unmount.
- **Narrow but real:** it needs an admin to take the `TEAM_KB_ACCESS_CONFLICT` retry path (`teams/server/errors.ts:17-20`), and the stale pane is under-stated rather than wrong-in-the-dangerous-direction. Recorded because it is the same class as the per-item-key rule and the acting agent explicitly reasoned about the *other* half of it.
- Proposed resolution: fix-now once F-181 lands — a predicate invalidation over `…/members/*/access` covers this case for free. Until then, return the affected member ids in the autoGrant response and enumerate them.
- Status: open

---

## F-184 — A returned 500 logs that it happened and nothing about why; the right seam is `with-auth.ts`

- Location: `src/shared/auth/with-auth.ts:57-89` (`runAndLog5xx`: the THROWN branch records name + message, the RESPONSE branch records only `5xx response: <status>` + `status_code`), `src/shared/api/http-error-response.ts:33-51` (always RETURNS its 500)
- Found during: the error-sanitizer sweep — the sweep's own destination has a note about this, and it belongs in the findings log rather than only in a docblock
- Severity: smell (observability)
- Description: the sanitizer sweep is a net win and this is its cost, stated honestly. `toHttpErrorResponse` `console.error`s the unmapped error and **returns** a generic 500. `runAndLog5xx` therefore always takes its RESPONSE branch, which writes a `system_events` row proving a 500 occurred and **saying nothing about what threw**. Message, error name and stack exist only on process stdout. The more routes adopt the sanitizer, the more of the health dashboard becomes "a 500 happened somewhere".
- **Why it was not fixed in the sanitizer:** calling `logSystemEvent` from `http-error-response.ts` pulls `@/shared/supabase/admin` — which THROWS at module evaluation on a missing `NEXT_PUBLIC_SUPABASE_URL` — into a `shared/` helper ~84 route modules import, so every route test touching an error path would need an analytics mock it does not have. That reasoning is correct and the honest note was the smaller change.
- **The right seam is `with-auth.ts`**, which already imports `logSystemEvent` and already owns both branches: give the response branch a cause to record — an `X-Error-Cause`-style internal marker the sanitizer sets and the wrapper strips, or a request-scoped store the sanitizer writes and the wrapper reads. Either keeps the durable trail in the file that owns the wrapper and adds nothing to the 84 importers.
- Proposed resolution: defer — real, cheap, and not launch-blocking. Do it the first time someone debugs a production 500 from the dashboard alone and cannot.
- Status: open

---

## F-185 — `teams/server/repository-resources.ts` reads and writes three other features' tables — pre-existing debt, now visible

- Location: `src/features/teams/server/repository-resources.ts:28,34,40` (`knowledge_bases` / `workflows` / `skills`), `:82`, `:140`, `:184-185` (an `access_mode` UPDATE on the resource's own table)
- Found during: the teams `repository.ts` 625 → 114 split
- Severity: smell (boundary) — **pre-existing; the split made it legible, it did not create it**
- Description: §0's rule is that a feature folder owns its own data. This module knows where another feature's resource lives, what its name column is called and who counts as its creator, and it writes `access_mode` on that feature's table. The file's own header says so plainly (*"the only part of the teams repository that reads or writes another feature's table"*), which is the good outcome of the split: 189 lines with an honest header beat the same code buried inside a 625-line file where nobody could see the boundary crossing at all.
- **Recorded, not scheduled.** The alternative shape — each owning feature exposing a `setAccessMode` its own repository implements, with teams calling three of them — is a real refactor across four features for a boundary nobody is currently tripping over. Its cost is that a fourth grantable resource type means editing teams rather than adding a resource.
- Proposed resolution: defer. **Revisit when a fourth grantable resource type is added**, which is the moment the current shape starts charging rent.
- Status: open

---

## F-187 — Pending-auth store: renderer-driven slot pressure, and the records are plaintext

- Location: `dopl-desktop-app/main/auth.js:36` (`PENDING_AUTH_MAX = 4`), `:123-127` (`writePendingAuth` → `list.slice(-PENDING_AUTH_MAX)`, newest-wins eviction), `main/auth-store.js:9-12` (`new Store()` — plain `electron-store`, no `safeStorage`)
- Found during: F-054's desktop enforcement round
- Severity: smell (both halves bounded; recorded so the bound is written down rather than re-derived)
- **(a) SLOT PRESSURE IS A DoS, NOT AN ADOPTION PATH.** `beginPendingAuth` appends and keeps the newest four. A renderer able to spam sign-in starts can therefore evict a legitimate in-flight OAuth record before its fragment returns — the handoff then finds no record and fails closed, which is the correct direction. **It cannot be used to get a fragment ADOPTED**: eviction removes records, and `pickPendingAuth` requires an exact 128-bit nonce match (or, for a state-less fragment, a record with no `requireState`, of which nothing writes any more since F-054). So the ceiling is "the user's sign-in does not complete", not "an attacker's session is adopted." Recorded because the reasoning is non-obvious and a future reader may otherwise treat `MAX = 4` as an authz bound.
- **(b) THE RECORDS ARE PLAINTEXT.** `auth-store.js` uses a bare `electron-store`; the session blob beside it is `safeStorage`-encrypted and `persist()` REFUSES to write when `safeStorage` is unavailable, but the pending-auth list gets neither treatment. It holds `{nonce, ts, requireState?, ttlMs?}` — the nonce is the capability. **The bound is the threat model, and it is worth stating:** anything that can read the store is a local process running as the user, which can also read the cookie jar and drive the app directly. So this is not a new exposure so much as a reason the nonce's TTL and single-use are load-bearing rather than belt-and-braces. **It does mean the app's security story stops at "no untrusted local binary"** — say that explicitly rather than implying the pending records are protected the way the session blob is.
- Proposed resolution: defer both. (a) is answered by the fail-closed direction; (b) by `safeStorage` on the pending list if the session blob's treatment is ever made mandatory. **Neither is launch-blocking; both should be re-read if the desktop ever gains a multi-user or shared-machine story**, which is the assumption both bounds rest on.
- Status: open

---

## F-189 — Closing a DM stopped being a LIVE event: the tombstone-hiding RLS policy makes its own CDC frame undeliverable (2026-08-10)

- Location: `supabase/migrations/20260810100000_channels_rls_hide_tombstoned.sql:202-213` (`channels_member_select`, the `AND deleted_at IS NULL` conjunct); `src/features/channels/server/repository.ts#softDeleteChannel` (the UPDATE that becomes invisible); `service-writes.deleteChannel` (the DM branch) and `service-workspace-departure.ts` (the departure branch) are the two callers
- Found during: post-apply reasoning about what C-15's policy change costs, in the same wave that applied it
- Severity: **bug (liveness regression, accepted for now)** — no data loss, no security consequence; the room is still correctly hidden, just not *promptly*
- Status: **open, ACCEPTED.** Shipped knowingly in `1d11a31`; recorded here so the trade is not rediscovered as a mystery.

**THE MECHANISM, WHICH IS THE WHOLE FINDING.** `channels` is in the `supabase_realtime` publication (verified: `channel_consent_requests`, `channel_members`, `channel_messages`, `channels`). Closing a DM is an **UPDATE** that stamps `deleted_at` — and `realtime.apply_rls` evaluates the **NEW** record against the subscriber's SELECT policy before delivering. That policy now requires `deleted_at IS NULL`. So the row the frame is announcing is, by the same statement that produced the frame, no longer visible to the subscriber, **and the frame is dropped.** The close was previously deliverable for exactly the reason §7 records about soft deletes generally: an `UPDATE` produces a full new record carrying `workspace_id`, so the `workspace_id=eq.<id>` filter matched and the doorbell rang. C-15 did not break the filter; it made the row fail the policy the filter is checked alongside.

**EFFECT:** the peer's sidebar keeps rendering a DM that is closed until their next refetch. Nothing is wrong on screen except the timing — `listChannels` filters `deleted_at IS NULL`, so the next read drops it correctly. **This is a downgrade from live to next-refetch, not a stale-forever bug.**

**⚠ THE OBVIOUS GENERALIZATION IS THE TRAP: this is a property of EVERY soft-delete-hiding SELECT policy, not of DMs.** Any table where (a) the tombstone is an UPDATE, (b) the table is in the publication, and (c) the SELECT policy excludes tombstones, has silently traded its delete doorbell for a refetch. `channels` is the only one in this codebase today because it is the only table that still soft-deletes AND is published — but the next `deleted_at IS NULL` added to a published table's policy inherits this for free and will not be noticed, because the failure is a frame that does not arrive.

**REMEDY SKETCHED, NOT TAKEN — and the ORDER is the whole design.** Touch the peer's `channel_members` row (a no-op `UPDATE`, e.g. re-stamping a column it already carries) **BEFORE** stamping the channel tombstone. `channel_members` is published and carries `workspace_id` in its replica identity (`20260807150000`, `REPLICA IDENTITY USING INDEX`), so that UPDATE rides the existing `CHANNEL_TABLES` / `SYNC_TABLES` doorbell both subscribers already refetch on. It **must** come first: `channel_members_member_select` was rewritten in the same migration to require `c.deleted_at IS NULL` on the parent channel, so the identical touch performed AFTER the tombstone is dropped for exactly the reason this finding opens with. A remedy for this bug is one statement away from being another instance of it.

**NOTE THE ASYMMETRY BETWEEN THE TWO CALLERS, because it is why this reads as "sometimes live".** The ordinary DM close (`deleteChannel`) writes only the `channels` UPDATE and is therefore fully dark. The **workspace-departure** close (`service-workspace-departure.ts`) also DELETEs the leaver's `channel_members` row, and a DELETE's deliverability turns on the subscription filter against `old_columns` (= the replica identity, which carries `workspace_id`) with `old_record` PK-redacted, rather than on a policy evaluation — so that path probably still rings the doorbell. **Reasoned from the deployed identity and §7's `apply_rls` note, NOT observed** — treat it as a hypothesis, and if you ever need it to be true, verify it against a live frame first. Same class of owed verification as F-190.

---

## F-190 — `channel_members` CDC may have gone dark for `authenticated`, and we will not know until someone watches a frame (2026-08-10)

- Location: `supabase/migrations/20260810120000_channel_members_column_privileges.sql` (the `REVOKE SELECT ON public.channel_members FROM anon, authenticated` + per-column `GRANT`); rollback named in that file's header (`GRANT SELECT ON public.channel_members TO anon, authenticated;` — one statement)
- Found during: writing the migration; recorded as an accepted risk at apply time, not discovered afterwards
- Severity: **bug (potential outage, unobserved)** — the security property holds either way; what is at risk is a doorbell
- Status: **open — VERIFICATION OWED AT FIRST LIVE OBSERVATION.** Do not close this by reasoning; close it by watching a roster change propagate.

**WHAT C-15 DID AND WHY IT IS A COLUMN PRIVILEGE.** Samuel's ruling: per-member settings are private, role and roster basics stay public. `dto.mapMemberRow` already scrubbed `agent_tool_profile` — but the DTO **is not on every path**, which is the sentence the old docblock got wrong. `channel_members` is published and `authenticated` held table-wide SELECT, so the RAW row reached any channel member over CDC and over PostgREST with the anon key the browser ships. **A column privilege binds both consumers where a policy binds neither** (RLS filters rows, not columns), which is why the enforcement moved to `REVOKE` + a per-column `GRANT` rather than to another policy.

**THE FAILURE MODE, STATED AS A CONDITIONAL BECAUSE THAT IS WHAT IT IS.** `realtime.apply_rls` redacts per column — but **if the deployed build tests table-level SELECT before it reaches the column loop**, the `REVOKE` reads as "no SELECT at all" and **every `channel_members` frame goes dark for `authenticated`**, not just the redacted column. That is not a security regression (dark is the safe direction) — it is the loss of the roster doorbell that §7 records as *already paid for* and that F-189's remedy proposes to lean on. Two findings would then be resting on a frame that no longer arrives.

**WHY IT WAS SHIPPED ANYWAY.** The security property is the ruling and it holds under either behaviour; the failure is degraded liveness with a **one-statement rollback** already written into the migration header. Shipping and watching costs less than staging a realtime harness for a question one live roster change answers.

**⚠ WHAT "VERIFY" MEANS HERE, precisely — because the wrong verification will read as a pass.** Do NOT verify by querying `information_schema.column_privileges`; that confirms the grant landed, which is not in doubt. Verify by **subscribing as an `authenticated` client and making a roster change** (add or remove a member), then checking whether the frame arrives and whether `agent_tool_profile` is absent from it. Three outcomes: frame arrives without the column (intended — close this finding); frame arrives WITH the column (the redaction does not bind CDC at all — a real leak, roll back and rethink); no frame (this finding is confirmed — roll back and find another shape). **And do not verify against upstream `walrus` master**, for the same reason §7 already warns about `apply_rls`: its master returns `coalesce(..., true)` in the neighbouring branch and says the opposite of what is deployed.

**THE STANDING RULE THIS LEAVES BEHIND (also in ENGINEERING §7/§8):** a new per-member SETTING must be added to `dto.mapMemberRow`'s scrub **AND** left out of that migration's `GRANT` list. Two edits, and the second is the one that binds. Adding it to only the scrub reproduces exactly the gap C-15 closed.

---

## F-191 — The C-20 sweep removes the member but not their SESSION and THREAD-PARTICIPANT rows (2026-08-10)

- Location: `src/features/channels/server/service-workspace-departure.ts#removeWorkspaceDepartedMember` (touches `channel_members` and `channels.deleted_at`, and nothing else); the unswept tables are `public.channel_sessions` (`20260805120000`) and `public.channel_task_participants` (`20260731130000`)
- Found during: verifying C-20's sweep half against the tables that carry a `user_id` alongside a channel
- Severity: smell (correctness of derived reads, no security consequence) — promoted from "not noticed" to "written down" precisely because the sweep's own docblock enumerates what it deliberately skips and these two are not in that list
- Status: open
- **Measured 2026-08-10 (production): 0 orphaned `channel_task_participants`, 0 orphaned `channel_sessions`, 0 ghost `channel_members`.** So this is a LATENT code gap, not an observed data problem — which is the honest framing and also the reason it is a smell rather than a bug. The C-20 backfill migration (`20260810140000`) found zero ghosts for the same reason: nobody has left this workspace yet.

**WHY IT MATTERS EVEN AT ZERO ROWS.** C-20's whole thesis is that a departed member must be *removed*, not *filtered* — Samuel's words were "fully and cleanly removed". The sweep delivers that for the roster, which is the table with a BEHAVIOUR attached (`classify`'s implicit trigger keys on an exact `memberCount === 2`). These two tables have no such trigger, so the cost is smaller: a departed user's rows keep appearing in session lists and thread participant sets, i.e. the same "roster keeps rendering someone who left" the sweep exists to end, one layer down. **The gap is not that the rows are dangerous; it is that "fully removed" is now true of one table and false of two, and nothing says so.**

**`channel_trust` IS FINE AND IS NOT PART OF THIS — verified, not assumed.** `trust-service.ts:47,60` calls `repo.isActiveWorkspaceMember(ctx.workspaceId, …)` on both the read and the grant path, so a trust rule naming a departed user is inert the moment they leave. That is the shape this finding is asking for on the other two, and it is worth noting that trust got there by **re-checking at read** rather than by sweeping at write — which is cheaper, needs no departure hook, and is the design to consider first.

**Proposed resolution — read the sweep's docblock before choosing.** Either (a) extend `removeWorkspaceDepartedMember` with two more deletes, or (b) filter at read the way trust does. **(b) is likely right for `channel_sessions`** (a session is an ephemeral fact and a departed user's is definitionally over) and **(a) for `channel_task_participants`** (a participant set is durable and is read for addressing). Whichever is chosen, the choice belongs in that docblock's "WHAT THIS DELIBERATELY DOES NOT SWEEP" section, which currently names only `channel_tasks`.

---

## F-192 — The desktop DMG downloads at ~0.9 MB/s: the landing page serves 195 MB straight off GitHub release assets, with no CDN (2026-08-10)

- Location: the landing-page download link → GitHub release asset URL (no intermediary); no Cloudflare/R2 or any other CDN in front of it
- Found during: a real download, timed
- Severity: smell (product/conversion, not correctness) — recorded because it is the first thing a new user experiences and nothing in the tree measures it
- Status: open — **needs Samuel's Cloudflare account, so it is gated on him, not on code**

**MEASURED, NOT ESTIMATED:** ~**0.9 MB/s** sustained, for a **195 MB** artifact ≈ **4 minutes** of staring at a progress bar before the app has done anything. GitHub release assets are not a CDN for this purpose: they are unaccelerated for most geographies and the rate is not something the repo can tune.

**WHY THIS IS WORTH AN ID rather than a TODO.** Every other launch-readiness item in this tree is about what happens *after* someone is running the app. This one is entirely *before*, it is on the only path a new user takes, and four minutes is comfortably past where downloads get abandoned. It is also the cheapest item on the list to fix relative to its reach.

**FIX SKETCHED:** put R2 (or any CDN) in front of the download and point the landing page at it, with the release asset as the origin so the publish flow does not change. **The blocker is an account, not an implementation** — this needs Samuel's Cloudflare account before anyone writes anything, so do not open a branch for it first. Two things to decide when it is unblocked: whether the auto-updater's feed moves too (it pulls from the same release assets and has the same problem, less visibly, on every update for every existing user), and whether the artifact itself can shrink — 195 MB is an Electron bundle and part of that number is a packaging question, not a delivery one.

---


## F-194 — SPA token/kit CSS is a hand-copy of the web's, and the drift debt lost its id (2026-08-11)

- Location: `apps/desktop-ui/src/styles/` (`tokens.css`, `kit.css`) vs the web tree's `src/app/globals.css` token + kit definitions
- Found during: the 2026-08-11 doc-anchor sweep — this is **F-074's debt, re-filed**. F-074 was deleted in the 2026-08-08 prune without landing on any of that pass's lists and WITHOUT being resolved; five references pointed at a hole until the sweep tombstoned the id. Never resurrect F-074; this entry is its successor.
- Severity: smell (drift risk)
- Description: the bundled SPA carries hand-copied design tokens and kit classes because it cannot import the Next tree's globals. A token or kit change on the web side does not propagate; nothing diffs the two. The `pending.ts` recipe explicitly designs around this ("token utilities only — no new CSS, nothing to mirror into the SPA's hand-copied kit.css"), which is the discipline that keeps the debt from growing; the existing copies are the exposure.
- Proposed resolution: defer — a build-step copy or a shared source file next time either file changes; at minimum a CI diff guard naming the divergent selectors.
- Status: open

## F-195 — Client-side optimistic-write idempotency covers 1 of 9 hooks (2026-08-11)

- Location: `src/features/channels/hooks/use-thread-writes.ts` (mints `client_msg_id`; the one) vs the 8 optimistic-write hook files that do not (chats `use-chat-writes.ts`, members `use-member-writes.ts` / `use-team-writes.ts` / `use-access-writes.ts` / `use-invitation-writes.ts` / `use-join-requests.ts`, channels `use-channel-lifecycle-writes.ts` / `use-channel-preference-writes.ts`; ontology creates ride the reducer)
- Found during: the 2026-08-11 INVARIANTS verification (its W5 — the doc claimed "every optimistic write mints one"; measurement said one of nine)
- Severity: smell
- Description: §7's idempotency rule ("a retry after a rolled-back failure returns the FIRST attempt's stored row instead of double-posting") is implemented only where the server already carried the unique index (`channel_messages.client_msg_id`). The other write families rely on UI inertness (`pendingRow`, disabled controls) to prevent double-submission — honest, but a layer down from where §7 says the guarantee lives. Extending it is per-family work: each needs a server-side unique key before a client mint means anything, so this is not a client-only sweep.
- Proposed resolution: defer — per family, when that family's writes next get server attention; the write-layer docs now state the true scope (INVARIANTS §8) so nothing over-claims meanwhile.
- Status: open
