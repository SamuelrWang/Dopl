# MCP / architecture v2 — WAVE B plan, from Samuel's rulings (2026-09-02)

**Status: SPEC. No code changes in this document.** Branch `v2/wave-b-plan`, cut from `v2/wave-a`
at `523bfc92` — the complete, reviewed Wave A.

**Input of record:** Samuel's rulings of 2026-09-02 (B1–B11, #18, X0, `summary`, `fields=`). They are
DECISIONS. Where this document differs from `docs/specs/mcp-v2-architecture.md` §2–§6 or from the four
investigation reports, the rulings win and the difference is named where it occurs.

⚠ **NUMBERS ARE QUOTED FROM A14's MEASUREMENT, NOT RE-DERIVED HERE.** This worktree has no
`node_modules`, so `npx vitest run src/tool-budget.test.ts` in `packages/mcp-server` — the command that
prints every served figure and fails on a drift in either direction — could not run. That is a
measurement about this worktree, not a claim about the tree. **Re-derive before acting on any figure**
(F-422).

---

## 1. Target model after Wave B

Delta from `mcp-v2-architecture.md` §2, updated by the rulings.

### 1.1 Tenancy — the default is a CONSTANT, not a lookup

**This is the whole of B10.** Today "the default workspace" is *derived* — the caller's legacy
`slug='default'` row, else their oldest owned `kind='standard'` workspace, else a count that refuses.
There is **no `is_default` column anywhere in the tree** (verified across `*.sql`, `*.ts`, `*.tsx`), so
the concept is entirely code and its removal costs no data. After Wave B:

> **Every user has exactly one `kind='personal'` container. When nothing is named, the answer is that
> container. `workspace=` names something OTHER than home, and only `list` and `create` can ask.**

That single sentence deletes the auto-target rule, the "2+ memberships" refusal, all three copies of its
refusal string, the session pin, and `noWorkspaceError` — because none of them has a question left to
answer.

| Concern | Wave A (today) | After Wave B |
|---|---|---|
| Container kinds | `standard \| link` (`packages/contracts/src/workspaces.ts:54`, mirrored 3×) | `standard \| link \| personal` |
| Personal shelf | `home_scoped BOOLEAN` on `knowledge_bases` + `agent_templates`, 3 live rows | `workspace_id` = the caller's personal container; **column drops**. ONE container per user, spanning home and every workspace they are in (ruling #18) |
| Default target | `findDefaultWorkspaceForUser` + sole-membership auto-target + a 0/2+ refusal | **the personal container, always.** No lookup, no count, no refusal |
| `workspace=` | on all 14 domain tools | **`list` and `create` only** (B2) |
| Read tenancy | `(workspace_id, id)` keyed | `resolveResource(id) → {containerId, type}` — ids resolve their own container |
| Cross-container use | copy ops (a snapshot that diverges, INVARIANTS §5A) | **grants** (B11). Copy ops deleted; F-419 disposed by deletion, not by a `copiedFromId` fence |
| Grant table | `channel_resource_grants` + `team_resource_access` + `agent_template_teams` + `workspace_resource_access` | one **`resource_grants(scope_type ∈ channel\|container\|team, scope_id, resource_type, resource_id, level)`**. **The team CAPABILITY is kept** (B4) — teams remain a scope you can grant to; what dies is the separate axis, the second table and the fifth predicate arm |
| Fence | 5 TS `canSee*` predicates, RLS **inert** (every repository reads `supabaseAdmin()`; 406 call sites) | **RLS is the fence** (B5), phased per table behind a flag; the TS predicate is deleted only after its policy is proven by a redteam test |

**Ruling #18, taken all the way.** A personal template/KB is usable from any container the user is in,
and sharing it is a grant. This **supersedes `docs/INVARIANTS.md:643** — *"A HOME-WORKSPACE TEMPLATE
CANNOT LAUNCH INTO A HOME CHANNEL, AND NO GRANT TABLE COULD FIX IT"* — which was true of a
workspace-keyed read and stopped being true when A12 generalised it. It also settles Wave A's open
item 18: `service-launch-template.ts › resolveTemplateForDirective` is still workspace-keyed and 404s
an id `readTemplateById` follows. **Both lanes follow the id** (slice B2).

### 1.2 Profiles — the header carries a PROFILE, and a role table is forbidden in code

B3. `X-Dopl-Tool-Profile` stays; `gating.ts › TOOL_PROFILE_TOOLS` — an **empty `Map` waiting for a
role→tool table** — is deleted. The header's accepted vocabulary becomes exactly the four containment
profiles, which are product-generic and already enforced locally:

| profile | offered | why it is not a role |
|---|---|---|
| `read_only` | local reads; `dopl_channel` op-scoped | zero-outbound containment |
| `dopl_only` | + web reads + non-admin Dopl MCP | no shell, no writes |
| **`channel_agent`** *(new, B7)* | `full` **minus `Bash`** | defense in depth for a session launched into a SHARED channel |
| `full` | `FULL_BUILTIN_BOUND` (derived from `BYPASS_TOOLS`, A5) | the coding lane |

⚠ **The genericity rule becomes a test, not a convention.** `tool-profile.test.ts` asserts the set of
values the server will narrow on is **equal to** `KNOWN_PROFILES` in
`dopl-desktop-app/main/tool-profiles.js:174` — so adding a persona ("courier", "orchestrator",
"supervisor") fails the build. That is the code that keeps Samuel's own orchestrator/sub-agent
structure out of the product. The header stays a HINT that may only NARROW; `disallowedTools` +
`grantDecision` remain the enforcement (`src/shared/auth/tool-profile-header.ts` already says so).

### 1.3 Channel surface — five ops

`send` · `read` · `status` · `manage` · `rooms`. 23 → 5, 35 params → ≤20. `20260907130000_channel_pings.sql`
is **never applied and is deleted** (B8): pings fold into a directed `send`, whose `delivery=` record
replaces the mailbox row.

### 1.4 Runtime

Claude and Codex ship; **Cursor is HELD** (X0) — it has no interrupt API. The three `runtime/*/tools.js`
copies collapse to one parameterised table for the two shipping lanes; Cursor's copy is frozen in place
and marked held, so a profile edit stops being a three-file edit (R9).

---

## 2. Messaging semantics, precisely

### 2.1 `send` — the one way to say anything

```
send(channel, body, to?, kind?, thread?, summary?, client_msg_id?, options?, recommendation?)
  → { seq, thread, delivery, recipient?, candidates? }
```

| field | contract |
|---|---|
| `to` | **at most one recipient.** A member (`email` or user id) **or an agent** (`@agent-<id>` or `@<handle>`, the `channel_sessions.name` grammar `^[a-z][a-z0-9-]{1,30}$`). ⚠ This widens today's fence — `service-writes-metadata.ts:154-160` refuses an agent in `to` with a 400. It becomes a UNION resolver. `metadata.to_user_id` is still stamped for member recipients, because consent cards key on it (`lib/message-receipt.ts:56`, `repository-account.ts:326`'s indexed JSONB predicate) |
| `kind` | `message` (default) \| `milestone` \| `decision`. **Three values, each with a fence.** `milestone` stores `kind:'task_progress'` and keeps A6b's 240-char / no-newline cap. `decision` stores `kind:'message'` + the escalation payload and keeps `escalation.ts:143-144`'s 2–6 options with consequence + recommendation. ⚠ A6 deleted a `kind` param whose own text said "LEAVE THIS UNSET"; this one has no unusable value. `question`/`blocked`/`done` from the messaging report are **not adopted** — a value with no distinct behaviour is prose wearing a schema |
| `thread` | a first-class uuid, the legacy `task-<ch>-<seq>` (kept until desktops age out), or **`"new"`** — which creates the thread and returns its id, folding `create_thread` |
| `summary` | the one-line intent, **≤200, tightened to match the route** (Samuel's ruling). On `thread:"new"` it is the thread title — same field, same cap, same meaning. This closes A14 open item 2: the schema stops publishing 2000 against a route that enforces 200, and `channel-schema-caps.test.ts › keeps summary at the LOOSER 2000` is **superseded by ruling**, not by a consistency pass |
| `client_msg_id` | per-author idempotency on every send (the `20260822120000` / `20260913120000` shape) |

**`delivery=` is the ack, and it is the only one.**

| verdict | means |
|---|---|
| `delivered` | a recipient resolved and a session already live on that thread/room received it |
| `woken` | a dormant recipient was woken; the desktop POSTs the ack on the session-health lane under D3's `sessionKey` fence |
| `idle` | resolved, nothing running — **the message is filed in the recipient's direction mailbox** (`channel_agent_directions`, kept as storage) and claimed when that machine next reconciles. `status` reads the state machine |
| `unreachable` | the recipient exists but this caller cannot reach it |
| `none` | no recipient: chat. It lands in the room and wakes nobody |

**An `@name` that resolves to nobody is REFUSED** — 400 `CHANNEL_RECIPIENT_UNRESOLVED`, listing the live
handles and the channel members. Never a silent `delivery=none`. This is the guardrail behind Samuel's
*"conversations must not stall on a forgotten @"*.

### 2.2 Fan-out narrowed to the addressed recipient (B1), with three resilience rules

The server resolves the recipient and computes the wake verdict **at write time**, stored on the row
(A9's `service-wake-verdict.ts`, extended). The desktop executes it and never re-derives addressing
from body text. The three rules are **server behaviour**, evaluated in order; the arms are disjoint by
(in a thread?) × (author kind), so exactly one fires.

| # | Condition | Recipient |
|---|---|---|
| **RR1** | reply in a THREAD with no `to` | **the thread's other party.** A thread has exactly two parties and `isThreadParticipant` already 403s a third, so "other" is total. If the author is not a participant (a legacy `task-` tag, silently stripped today) the send returns `delivery=none` with `landed=stripped` — the distinction A6 introduced, not a new one |
| **RR2** | unaddressed AGENT-authored post in the MAIN room | **the party that last addressed this agent in this room inside the window.** Window = `RESILIENCE_WINDOW_MS = 15 min`, the value already used for `MAX_CHAINED_LAUNCHES`' channel-scoped window, declared once in `src/shared/channels/caps.ts` (A7's module). Selection: highest `seq` among rows in this channel with `thread IS NULL`, `created_at > now() - 15 min`, whose STORED resolved recipient is this agent. **`seq` is unique per channel, so the tie-break is total and no tie is representable.** No such row ⇒ `delivery=none` — an agent talking to the room with nobody having addressed it is a broadcast, and the standing "agent-authored unaddressed starts nobody" rule holds for exactly that case |
| **RR3** | unaddressed HUMAN message | 1. the channel's **default responder** if it is live → it; 2. else exactly one live agent in the channel → it; 3. else `delivery=none`, and the result LISTS the live handles |

**The default responder is a channel setting** (B6): `channels.default_responder_agent_name TEXT`, the
handle grammar, **manage-gated on the server** (`member`+ and the channel's manage floor — not a UI
gate), surfaced in the channel Settings tab. ⚠ It stores a HANDLE, not a template id, for the reason
`20260823130000_channel_sessions_template_name.sql` gives for its own column: an FK to `agent_templates`
would be a cross-visibility reference from a row container members can read. It degrades safely — a
handle with no live session falls to RR3 arm 2, then arm 3.

⚠ **This lands in the same Settings section as F-449** — the channel ceiling (`agent_tool_ceiling`,
`agent_message_ceiling`, `agent_chain_allowed`) has no editing surface at all, which is why A9's clamp is
armed and unarmed. One control panel, two settings, one manage gate: no second surface.

**LLM TRIAGE is deleted** (B6). `main/session-triage.js` (234) and `main/runtime/claude/triage.js` (120)
go whole; ~165 of `session-wake-tiers.js`'s 377 lines go with them; `tierFor` collapses to
`n === 1 ? SOLO : NONE` and then to nothing, because RR3 arm 2 IS solo, computed server-side for free.
`targeting.js › classify` — the fifth parallel rule set the fan-out never consulted — collapses to two
questions. **12 rules over "who wakes" in 3 modules become 1 predicate with 1 test.**

**Composer @-chips** (B6): `components/channels-v2/composer-mentions.tsx:87` already offers agents but
only *"THIS machine's own agents, or none off-desktop"*. It widens to the channel's LIVE agents from
`channel_sessions` via the peer-safe projection (`collab-dto.ts › mapPeerSessionStateRow`), so tagging is
discoverable from the web too. No new endpoint — the Agents tab already reads that list.

### 2.3 Old op → new, one-line redirect for one release

23 ops today (`channel-schema.ts:90-135`). Each old name returns ONE line naming its replacement and
nothing else, for one minor release; the redirect is deleted in the release after the desktop version
floor no longer calls it.

| old | new | preserved at the seam |
|---|---|---|
| `post` | `send` | `metadata.to_user_id` strip/restamp (`service-writes-metadata.ts:260,311`) |
| `milestone` | `send(kind="milestone")` | stores `task_progress`; 240-char cap |
| `escalate` | `send(kind="decision", options, recommendation)` | `ESCALATION_METADATA_KEY`, answer pairing, the `20260902120000` first-answer-wins index |
| `create_thread` | `send(thread="new", to, summary=<title>)` | per-author idempotency |
| `ping` / `pings` | `send(to=…)` / `read` | **`20260907130000` is deleted unapplied** (B8) |
| `direct_agent` | `send(to=@agent)` landing `delivery=idle` | `channel_agent_directions` kept as STORAGE; the op goes |
| `read` / `await` | `read(since=)` | `await` is already denied for desktop sessions (T85). AWAITING (3,914 ch) + both handlers + the budget module delete |
| `read_sessions` / `read_directions` | `status` | |
| `launch_agent` / `end_agent` / `rename_agent` / `set_agent_mode` | `manage(op="launch\|end\|rename\|posture")` | A9's server clamp, A10's `client_msg_id` + resolved template id |
| `list` / `open` / `invite` / `members` / `list_threads` / `set_thread_mode` / `update` | `rooms(op=…)` | info-card-only `update` (ruling Q12(b)) |
| `help` | `rooms(op="help", section=)` | **sectioned, not deleted** (Wave A ruling 14). It sits on `rooms` because `rooms` already answers *what is this place* — the law of the place is the same question, and it keeps the op count at five |

⚠ **The tripwire is `parity.test.ts`, not the schema.** `READ_OPS.dopl_channel` (`:58-93`) and
`gating.ts:159+`'s `WRITE_OPS` are two hand-maintained lists the harness asserts are ⊆ the enum and
jointly cover it, and the harness parses `gating.ts` **as source text** — so comments in that block may
not contain double-quoted words. Both lists are first-class edits in the collapse slice.

⚠ **Doctrine keys move with the ops.** `channel-doctrine.ts:286-301` (14 sections), `channel-schema.ts:142`'s
`section` enum and `channel-doctrine-budget.test.ts:57-76`' per-section caps + pairing assertion are one
change. `REFUSALS` (~5,765) and `CHANNEL_OWN_AGENTS` (~4,873) are 36% of the document and are almost
entirely about the six agent ops — `manage` absorbing them is where the budget comes back.

### 2.4 Every surface that reads the old kinds or ops, with its owner

| surface | reads | owner slice |
|---|---|---|
| `src/features/channels/server/service-writes-lifecycle.ts` (117) | the credential-level lifecycle refusal (G2 — keyed on `ctx.source`, correct, do not "fix") | B4 |
| `service-writes-metadata.ts` (423) + 8 satellites + 9 tests | `to_user_id`, mentions, thread, escalation, markers | B4 |
| `service-wake-verdict.ts` (284) | kind → wake | B4 |
| `service-tasks-fanout.ts` (206) | one of THREE unrelated things called "fan-out" (C16) — renamed here | B4 |
| `components/channels-v2/view-model-rows.ts:47-53,245,268` | lifecycle kinds → receipt rows; `task_progress` deliberately stays prose | B9 |
| `components/channels-v2/transcript.tsx:125-165` | `system \| receipt \| thread-card \| escalation \| message` | B9 |
| `lib/message-receipt.ts` (212), `lib/calm-terminal.ts` (75) | kind → status; calm-terminal suppression | B9 |
| `escalation-card-row.tsx` (190), `agent-stream-escalation.tsx` (128), `view-model-escalation.ts` (191) | the decision card and its answers | B9 |
| `thread-consent.tsx` (55), `use-inline-consent.ts` (58), `use-consent-inbox.ts` (77), `types-consent.ts` (102) | consent — **web-only, no SDK twin, no MCP op**; unchanged by the collapse except that `to_user_id` now arrives from a union resolver | B4 (server), B9 (assertion only) |
| `packages/mcp-server/src/tools/channel-escalate-render.ts`, `channel-ops-write.ts`, `channel-errors.ts` | render + refusals | B8 |
| desktop `main/` — 15 files switching on kind, of which `session-dispatch.js` (500), `session-wake-tiers.js` (377), `targeting.js` (329), `listener-messages.js` (187), `session-gate.js` (204), `pings.js` (170) are the delivery core | wake, addressing, deferral | B9 |

⚠ `apps/desktop-ui` contains **no** channel transcript — `channels-v2` was cut over into the shared
feature tree (`routes.test.tsx:150-224`). One UI tree, not two.

---

## 3. Default-workspace removal — every site, its replacement

**No data migration for the default itself: there is no column.** The personal container is the only new
row, and there are 15 users.

| # | Site | Replacement |
|---|---|---|
| 1 | `workspaces/server/repository.ts:96-118` `findDefaultWorkspaceForUser` (+ `:120-127` `countWorkspacesOwnedBy`, `:129-170` `listWorkspacesOwnedBy`) | **renamed `findSoleOwnedStandardWorkspace`, billing-only**, and the legacy `slug='default'` branch deleted. Two callers remain (rows 12–13); every tenancy caller goes |
| 2 | `workspaces/server/service.ts:178-200` `ensureDefaultWorkspace` + `:204-222` `renameDefaultWorkspaceIfUntitled` | `ensurePersonalContainer(userId)` — same advisory-lock SELECT-or-INSERT shape, `kind='personal'`, one per user. **Signup still seeds a standard workspace** (unchanged, out of the ruling's scope); it is simply no longer *the default* |
| 3 | `20260802200000_ensure_default_workspace_rpc.sql` + `20260823160000_default_workspace_kind_guard.sql:43-110` (the live `CREATE OR REPLACE`) | `ensure_personal_container(p_owner_id)`; both dropped. ⚠ The kind guard exists ONLY to stop a `kind='link'` container becoming a default — with no default it has nothing to guard |
| 4 | `src/shared/supabase/types.ts:2470-2489` generated `ensure_default_workspace` | regenerate |
| 5 | `workspaces/server/service.ts:140-172` `resolveActiveWorkspace` — the count at `:153-155`, auto-target `:156-158`, refusals `:165-170` | no count. Explicit target (URL segment or `X-Workspace-Id`) or the personal container. `WorkspaceResolutionError` keeps `WORKSPACE_INVALID` and loses `WORKSPACE_REQUIRED`; `WorkspaceChoice[]` deletes |
| 6 | `packages/mcp-server/src/factory.ts:184-188` `listable.length === 1 ⇒ "sole membership"`; `:176-182` session pin | `active` = the caller's personal container, always. `WorkspaceSource` drops `"sole membership"` and `"session pin"` |
| 7 | `workspace-directory.ts:189-247` `noWorkspaceError()` (refusal at `:225`, home-channel note at `:232`) | **deleted, ~50 lines** — unreachable once there is always an active container |
| 8 | `meta-tools.ts:313` the second copy of the 2+ refusal; `:125-180` `opSetPin`/`opClearPin` | deleted with the pin |
| 9 | `instructions.ts:84-100` `membershipLine`; `:281,302-307` the `workspace=` contract sentence | one line: *"no `workspace=` ⇒ your personal container"* |
| 10 | `session-pin.ts` (139) + `session-pin.test.ts` + `session-pin-boot.test.ts`; producer `src/app/api/mcp/route.ts:114-120`; `with-mcp-transport-auth.ts:36-50` | **deleted whole.** `sessionKey` survives ONLY as D3's delivery-ack fence |
| 11 | `registrar.ts:322-324` `if (!activeWorkspace) return noWorkspaceError()`; `:385,407-413` `firstListableWorkspaceId()` | the guard is unreachable and deletes. ⚠ `firstListableWorkspaceId` is a **second, un-obvious default** — a billing fallback for charged meta-tools; it becomes the personal container |
| 12 | `billing/server/webhook-handler.ts:85-111` Stripe grandfather | `findSoleOwnedStandardWorkspace`; **refuses on ambiguity** (400 + alert) instead of warning and guessing (`:95-99` already warns). A silent wrong-workspace charge becomes a refusal |
| 13 | `billing/server/credits-service.ts:91-114` `resolveBillingTarget` — link-container burn → owner's default | same rename. ⚠ **This is the one open question (§7)** |
| 14 | `src/app/billing/page.tsx:35`, `src/app/api/workspaces/ensure-default/route.ts`, `src/app/auth/callback/route.ts:51`, `workspaces/server/segment.ts:353-380`, `onboarding/server/service.ts:66`, `seed-workspace.ts:25` | all call `ensurePersonalContainer`; `/billing` with no segment renders the workspace list instead of guessing; the dedicated `ensure-default` route is deleted |
| 15 | `workspace-switcher-core.tsx:52-56`, `app-shell.tsx:278-282` (rail), `workspace-danger-zone-core.tsx:38-48` (post-delete landing), `pricing-content.tsx:105-115` | the rail lists `standard` only (unchanged — the personal container has its own surface, `/home`); post-delete lands on `/home`, which always exists |
| 16 | `status-footer.ts:46` `workspace_source:` + the 4-member `WorkspaceSource` union | two values: `"per-call arg"`, `"header pin"`. Per C20 the footer already emits only when the source is a per-call arg |
| 17 | `isStandardWorkspace` — **3 hand-mirrored definitions, 18 call sites** (`workspaces/types.ts:89`, `packages/dopl-client/src/types.ts:104`, and the **committed `dist/types.js`** that `scripts/check-role-drift.ts:279-301` actually reads) | one declaration in `@dopl/contracts`; `WorkspaceKind` gains `"personal"`; the drift check reads the source, and `dist/` is rebuilt in the same commit |
| 18 | `home_scoped` — 2 migrations, 2 write sites, 5 read/filter sites, 2 API routes, 8 schema/type/error sites, 8 SDK files, 8 UI files, `tools/shelf.ts` (128) + 6 MCP consumers | `workspace_id = personal container`; column dropped. ⚠ `scripts/check-knowledge-type-drift.ts:191-203` **hard-asserts exactly 2 migrations declare it** — the gate moves in the same commit or CI goes red |
| 19 | `resolveHomeScope` ×2 — `knowledge/server/service-base-gates.ts:52-75` and `agent-templates/server/service-writes.ts:78-99` (divergent: private-terminal vs private-floor) | both delete. "Is this my home workspace" has no other definition, which is why they are structurally coupled to row 1 — and why the column and the resolver must go together |
| 20 | `tools/home-scopes.ts` (141) — `listHomeChannels`, `narrowToLock`, `searchLegs` | `narrowToLock` moves to `workspace-directory.ts` (the container LOCK is a FENCE, not a default — keep it); the rest deletes with `dopl_home` |

**Migration + backfill.** Three ordered steps, dual-written across one release (tenancy risk 3 — a single
migration rolls back OPEN):

1. `20260920120000_workspace_kind_personal.sql` — widen `workspaces_kind_check` to
   `('standard','link','personal')`; add `ensure_personal_container`; **mint one personal container per
   user** (15 rows) minted FROM today's derived default (name, owner, created_at) so nothing is invented;
   partial unique index on `(owner_id) WHERE kind='personal'`.
2. **Dual-write release.** Writes set BOTH `home_scoped` and `workspace_id`; reads prefer
   `workspace_id` behind `TENANCY_PERSONAL_CONTAINER` (default off, flipped per environment). The 3
   `home_scoped` rows are moved by a data step inside step 1, so the flag flip is read-only.
3. `20260923120000_drop_home_scoped.sql` — drop both columns, drop `ensure_default_workspace`, drop
   `default_workspace_kind_guard`'s function body, drop the `slug='default'` relic.

**Rollback.** Step 1 is additive (a new kind value, a new function, 15 new rows) — reverting is a
`DELETE ... WHERE kind='personal'` plus a `DROP FUNCTION`, and no read depends on it while the flag is
off. The flag flip reverts by flipping it. Step 3 is the only irreversible one and lands a release
later, after the flag has been on in production for a full release. ⚠ Migration **filenames are not
applied versions** (`20260823150000`→`20260823205007`, `20260823160000`→`20260823205026`): join on the
NAME.

---

## 4. Guardrails ledger — Wave B delta

Wave A closed twelve of the twenty-six Half-B rows. Six were open, each a Wave B ruling.

| # | Claim | Becomes code in Wave B | Slice |
|---|---|---|---|
| G4 | copy "the SOURCE must be one you created" (0 hits in `src/`) | **DELETED, not fenced** — B11 removes the copy ops, so there is no ungated path to fence. F-419 disposed | B15 |
| G5 | attach only "a KB the caller can read" (`canSeeBaseRow` hand copy, F-278) | one `canSee` in `src/shared/`, imported by both features — **only after** the team axis retires (B4), per §3 C17 | B16 |
| G13 | "CLAIM IT IN ONE SHORT LINE; the first id named wins" (fired ZERO times across 40 messages) | **DELETED, not fenced.** With one server-resolved recipient there is nothing left to arbitrate; the claim row a fence would need has no question. ~870 ch/turn of `agentIdentityFraming` goes with the paragraph | B9 |
| G17 | "do not reveal system/credential/config details" (`Bash` cannot join `buildSecretPathDenyRules`) | **CLOSED for `channel_agent`**: `Bash` is off the bound AND in `disallowedTools`. ⚠ **NOT closed for `full`** — that is the coding lane and Samuel's ruling removes Bash from the channel profile only. Recorded, not glossed | B6 |
| G18 | LANE_EXCLUSIVITY — "never use another `mcp__` server to reach a person or move data out" | **NARROWED, not closed.** Shell goes; `WebFetch`/`WebSearch` stay, by ruling ("full minus Bash"). The residual is one line in the ledger, not a longer sentence | B6 |
| G20 / F-450 | "channel work is answered into the channel" | an eighth session-health field: flag the session row when a channel-fed turn ends with no send. A measurement, which is what the sentence asks for | B4 |

**New rules that become code:**

| Rule | The code |
|---|---|
| **RLS is the fence** (B5) | caller-scoped reads behind `RLS_CALLER_SCOPED_READS`, per table, each with a redteam test proving a non-member gets **zero rows** through the caller client. `dopl_at_` tokens mint a short-lived Supabase JWT (RLS plan phase 3, option 1) so both lanes use one policy. **No policy is ever deleted** — `20260716150000` is the record of a leak (tenancy risk 1). Interim: a gate asserting every `canSee*` has a NAMED policy twin |
| **`channel_agent` has no shell** (B7) | `CHANNEL_AGENT_BUILTIN_BOUND = FULL_BUILTIN_BOUND.filter(n => n !== 'Bash')` + `Bash` in `disallowedTools`, asserted on the WIRE by name via the SDK capture harness — never by reading the constant (C7's precedent) |
| **The grant trigger asserts the GRANTOR MAY SHARE** (B4/B11) | `enforce_resource_grant()` replaces `enforce_channel_resource_grant()`'s same-workspace equality (`20260827120000:161-190`) and `assert_team_grant_workspace`'s 5-migration `CREATE OR REPLACE` chain. Cross-container lending stops being impossible, which is what forced copies |
| **Send-time recipient resolution** | `@name` → nobody is a 400 listing live handles; `delivery=` on every send; the wake verdict stored on the row. Turns G11, G12, G15 and the `@<slug>` doc/code disagreement (F3) into facts |
| **The profile header cannot grow a role table** | `TOOL_PROFILE_TOOLS` deleted; a test asserts the accepted vocabulary EQUALS `KNOWN_PROFILES` |
| **The default responder is manage-gated on the server** | the channel settings PATCH floors at the channel's manage role; the UI control is an affordance, not the gate |
| **`summary` is one number** | schema 200 = route 200; the renderer publishes the `Limits:` block `dopl_channel` does not have today |

**Prose deleted with them:** `HOME_CHANNEL_ADDRESSING` (708) · `AWAITING` (3,914) · `REFUSALS`
5,765→~1,200 table · `CHANNEL_OWN_AGENTS` 4,873→~800 · the shelf sentences and `SHELF_ARG_DESCRIPTION`
×2 · the three copies of the 2+ refusal (`service.ts:165-170`, `workspace-directory.ts:225`,
`meta-tools.ts:313`) · `membershipLine` · the ~330-ch stand-down preamble every non-addressed reader
pays (worst 725) · `agentIdentityFraming`'s claim protocol (~870/turn) · the `personalShelfNoun` regex
over the server's own error strings (`shelf.ts:126-128`).

---

## 5. Build plan — slices with disjoint file ownership

**Ownership protocol (Wave A's, which was the binding constraint, not the code).** No two slices touch
the same file. A slice needing an edit inside a file another slice owns records a cross-slice request;
the owner lands it. Contested files assigned once:

- `packages/mcp-server/src/tools/channel-schema.ts` + `channel.ts` + `channel-ops-*.ts` → **B8 alone.**
- `packages/mcp-server/src/tool-budget.test.ts` → **B8 alone** (it holds every ratchet).
- `packages/mcp-server/src/gating.ts` → **B5 alone**; B8 sends it the `WRITE_OPS` rewrite as a cross-slice request.
- `src/features/agent-templates/server/repository.ts` → **B1 alone** in batch 1; released to B11 in batch 2.
- `src/features/channels/server/service-writes-metadata.ts` + `service-wake-verdict.ts` → **B4 alone.**
- `dopl-desktop-app/main/tool-profiles.js` + `main/runtime/*/tools.js` + `main/session-profiles.js` → **B6 alone**; `main/runtime/claude/loader.js` → **B5 alone.**
- `.github/workflows/ci.yml` → **B7 alone** (the RLS flag's gate); every other slice asserts in its own new test file.

**GATES** (every slice, unless it says otherwise): five suites · both lints `--max-warnings 0` · both
typechecks incl. `-w @dopl/desktop-ui` · the **eight** non-suite gates **re-derived from
`grep -n 'run:' .github/workflows/ci.yml`, not from CLAUDE.md, which has been wrong three times** ·
`node scripts/check-doc-refs.mjs` · `size-check` 500-line cap · a `build:packages` when any committed
`dist/` mirror moves. **Migration replay is owed and has never run** — Docker was down for all of Wave A.

### Batch 1 — foundations. Additive; nothing narrows; external callers unaffected.

| Slice | Branch | Owns | Scope | Tests | Rollback | F-ids | Migrations |
|---|---|---|---|---|---|---|---|
| **B1** grants + team retirement | `v2/b-grants-and-teams` | `src/features/teams/server/repository-grants.ts`, `src/features/agent-templates/server/repository.ts`, `src/features/knowledge/server/{repository-channel-grants,service-channel-grants}.ts`, `src/app/api/knowledge/bases/[baseId]/channel-grants/route.ts`, `src/features/knowledge/schema-sql.test.ts` | `resource_grants(scope_type ∈ channel\|container\|team, …)` + `enforce_resource_grant()`; backfill 2 channel grants + 5 inert team rows; **then** drop `agent_template_teams` (0 rows, 3 queries), **then** `team_resource_access` (11 queries, 13 migrations, 5-migration trigger chain). Team stays a SCOPE (B4) | three behavioural probes per trigger branch inside a rolled-back txn (the `20260827120000` precedent); `schema-sql.test.ts` REWRITTEN, not deleted | three ordered migrations, each independently revertible; grants additive, drops last | F-460..469 | `20260914120000_resource_grants`, `20260915120000_drop_agent_template_teams`, `20260916120000_drop_team_resource_access` |
| **B2** id resolution completed | `v2/b-id-resolution` | `src/shared/tenancy/resolve-resource.ts`, `src/features/*/server/repository-tenancy.ts`, `src/features/channels/server/service-launch-template.ts` | Generalise A12's pilot to `knowledge_base`, `skill`, `chat`. **Reads accept `workspace=` as optional-and-IGNORED.** Reconcile `resolveTemplateForDirective` with `readTemplateById` — both follow the id (Wave A open item 18, ruling #18) | one resolution test per type; a test that the two launch lanes agree on the same id | revert one commit; routes still accept `workspace=` | F-470..479 | — |
| **B3** credential axes | `v2/b-credential-axes` | `src/shared/auth/credential-audience.ts`, `src/features/channels/server/service-launch.ts` lock reads, `dopl-desktop-app/main/session-credential.js` | Split `mcp_tokens.workspace_lock_kind` → `container_id` + `subject_user_id`; `isSharedCredential` collapses to one null check. **Must precede B13** (tenancy risk 4: never remove the lock while removing `workspace=`) | the three-arm predicate becomes one, pinned both ways | additive columns; old field read until B13 | F-480..489 | `20260917120000_mcp_token_credential_axes` |
| **B4** send semantics (server) | `v2/b-send-semantics` | `src/features/channels/server/{service-writes-metadata*.ts,service-wake-verdict.ts,service-writes-lifecycle.ts,service-tasks-fanout.ts→service-tasks-broadcast.ts}`, `src/features/channels/components/channels-v2/{settings-tab,channel-manage}.tsx` | `to` accepts an agent (union resolver); RR1/RR2/RR3 stored at write time; `delivery=` extended; `CHANNEL_RECIPIENT_UNRESOLVED`; `default_responder_agent_name` + the Settings control (**and F-449's ceiling control in the same panel**); G20/F-450 | a **composed** test driving server verdict + desktop execution together (GAP C precedent); one test per resilience arm incl. the degenerate ones; `RESILIENCE_WINDOW_MS` asserted from `caps.ts`, not quoted | additive column + additive verdict values; the desktop still fans out until B9 | F-490..499 | `20260918120000_channel_default_responder` |
| **B5** profile header | `v2/b-profile-header` | `packages/mcp-server/src/gating.ts`, `server.ts`, `src/shared/auth/tool-profile-header.ts`, `dopl-desktop-app/main/runtime/claude/loader.js` | Delete `TOOL_PROFILE_TOOLS`; narrow on PROFILE; the genericity test | the accepted vocabulary EQUALS `KNOWN_PROFILES`; wire list asserted BY NAME | revert one commit | F-500..509 | — |
| **B6** `channel_agent` profile | `v2/b-channel-agent-profile` | `dopl-desktop-app/main/tool-profiles.js`, `main/session-profiles.js`, `main/runtime/{claude,codex}/tools.js`, new `main/runtime/tool-table.js`, `main/runtime/cursor/tools.js` (frozen) | 4th profile = `full` minus `Bash`, denied by name; one shared tool table for the two shipping lanes (X0: Cursor held) | SDK capture asserting `Bash` absent by NAME; `session-profiles.test.mjs` deepEqual moves with it | one line restores `FULL_BUILTIN_BOUND` | F-510..519 | — |
| **B7** RLS real, phase 1 | `v2/b-rls-real-1` | `src/shared/supabase/**`, `src/shared/auth/with-auth.ts` (JWT mint), `src/features/knowledge/server/repository-bases.ts`, `.github/workflows/ci.yml` | Mint a short-lived Supabase JWT for `dopl_at_`; caller-scoped read client behind `RLS_CALLER_SCOPED_READS`; repair + prove policies on `knowledge_bases`, `knowledge_entries`, `knowledge_folders`. **No TS predicate deleted.** Ship the pair gate (every `canSee*` has a named policy twin) | a redteam case per table: a non-member gets **zero rows** through the caller client; happy path unchanged with the flag off | flag off; policies are never deleted (tenancy risk 1) | F-520..529 | `20260919120000_rls_helpers_and_caller_scope` |

### Batch 2 — narrowing. Wire-visible; redirects live; nothing deleted yet.

| Slice | Branch | Owns | Scope | Tests | Rollback | F-ids | Migrations |
|---|---|---|---|---|---|---|---|
| **B8** ops collapse 23→5 | `v2/b-ops-collapse` | `packages/mcp-server/src/tools/channel*.ts` (all), `tools/{members,ontology,agent}.ts`, `tools/response-size.ts`, `tool-budget.test.ts`, `parity.test.ts` | `send/read/status/manage/rooms` + a one-line redirect per old name; doctrine re-sectioned to the five; `summary`→200; `Limits:` block; the `ping:` cursor arm retires with the lane. **Plus A14's three open Q7 FIXes**, which are response-size knobs pinned by the same ratchet: `fields=` on `dopl_members` — where **`id` is always included by construction**, so it is neither listable nor omittable (Samuel's ruling) — `response_format` on `dopl_ontology`, `max_chars` on `dopl_agent(op="get")` | `parity.test.ts` ⊆ and coverage both directions; re-run `listTools()` and LOWER every ratchet in the same commit | old ops still answer; revert one package | F-530..539 | — |
| **B9** fan-out narrowed | `v2/b-fanout-narrow` | `dopl-desktop-app/main/{session-dispatch,session-wake-tiers,targeting,listener-messages,session-gate,pings}.js`, `main/session-triage.js`, `main/runtime/claude/triage.js`, `src/features/channels/components/channels-v2/{view-model-rows,transcript}.tsx` | Execute the stored verdict; **delete TRIAGE whole** (354 lines + ~165 of the tiers module + 4 test files); `classify` → two questions; one lane in `listener-messages.js` | the composed drive from B4 re-run against the narrowed desktop; a test that a sibling is NOT fed | `WAKE_TIERS_ENABLED` is already a kill switch; the verdict is stored, so reverting the desktop restores fan-out | F-540..549 | — |
| **B10** composer chips | `v2/b-composer-chips` | `src/features/channels/components/channels-v2/composer-mentions.tsx`, `composer-input.tsx`, `src/features/channels/lib/agent-mentions.ts` | @-chips over the channel's LIVE agents, not just this machine's | the picker offers a peer's agent handle; no operator-only field leaks (`mapPeerSessionStateRow`) | revert one commit | F-550..559 | — |
| **B11** personal container | `v2/b-personal-container` | `supabase/migrations/*`, `src/features/knowledge/server/repository-bases.ts`, `src/features/agent-templates/server/repository.ts`, `packages/mcp-server/src/tools/shelf.ts`, `scripts/check-knowledge-type-drift.ts` | Mint one per user; move the 3 `home_scoped` rows; **dual-write for one release** behind `TENANCY_PERSONAL_CONTAINER` | a stale-cache test per new payload field (`?? EMPTY_X`, INVARIANTS); both read paths agree under the flag | flag off; the column still carries the truth | F-560..569 | `20260920120000_workspace_kind_personal` |
| **B12** RLS real, phase 2 | `v2/b-rls-real-2` | `src/features/{skills,agent-templates,chats}/server/**` read paths | `skills`, `agent_templates`, `chats`, `resource_grants` behind the same flag | a redteam case per table | flag off | F-570..579 | `20260921120000_rls_phase2_policies` |

### Batch 3 — deletion. Only after batch 2 has run one release.

| Slice | Branch | Owns | Scope | F-ids | Migrations |
|---|---|---|---|---|---|
| **B13** `workspace=` off | `v2/b-workspace-arg-off` | `packages/mcp-server/src/{registrar,factory,server,workspace-directory,meta-tools,instructions,session-pin,status-footer}.ts`, `tools/{home,home-scopes}.ts` | B2: `workspace=` on `list`/`create` only. Delete `session-pin.ts`, `home-scopes.ts`, `noWorkspaceError`, the auto-target, both pin ops. `dopl_home` deleted; `current_workspace`+`list_workspaces` → one `dopl_workspaces`. **13 tools → 11** | F-580..589 | — |
| **B14** default workspace off | `v2/b-default-workspace-off` | `src/features/workspaces/server/{repository,service,segment}.ts`, `src/features/billing/server/{webhook-handler,credits-service}.ts`, `src/app/billing/page.tsx`, `src/app/api/workspaces/ensure-default/route.ts`, `src/app/auth/callback/route.ts`, `src/shared/auth/with-workspace-auth.ts`, `packages/contracts/src/workspaces.ts`, `scripts/check-role-drift.ts` | §3 rows 1–17 | F-590..599 | `20260922120000_drop_default_workspace_rpc` |
| **B15** copies off | `v2/b-copies-off` | `packages/mcp-server/src/tools/{knowledge-ops-copy,agent-ops-copy,copy-target,shelf}.ts` + the two enums, `src/features/agent-templates/lib/template-draft.ts`, `apps/desktop-ui/src/pages/home/agent-copy.tsx` | B11: delete the copy ops (681 MCP lines + 490 draft/UI); drop `home_scoped`; delete `shelf.ts` and both `resolveHomeScope` | F-600..609 | `20260923120000_drop_home_scoped` |
| **B16** old ops + TS fences off | `v2/b-old-ops-off` | `packages/mcp-server/src/tools/channel-ops-await*.ts`, `channel-ops-ping.ts`, `channel-doctrine.ts`, `src/features/channels/server/{service-await*,service-pings*}.ts`, `src/app/api/pings/**`, `supabase/migrations/20260907130000_channel_pings.sql`, the five `canSee*` → one `src/shared/` predicate | Retire the redirects; delete the `await` lane (AWAITING 3,914 + two handlers + the budget module) and the ping lane; **delete `20260907130000` unapplied** (B8); delete the TS predicates RLS now holds, one at a time, each behind its own green redteam test | F-610..619 | — |

**Sequence, and why.** id-resolution (B2) → credential-axis split (B3) → `workspace=` removal (B13),
per tenancy risk 4. RLS made real per table behind a flag (B7, B12) **before** any TS fence is deleted
(B16), per risk 1. Ops collapse with redirects (B8) **before** retirement (B16). Team retirement (B1)
**before** unifying `canSee` (B16), per C17. And "naming" (B2) and "using" (B15) sit in different
batches so a regression is attributable — which is how tenancy risk 7 is honoured inside one wave: a
batch, fully gated and independently revertible, is this wave's attribution boundary.

**Migrations.** Ten, strictly increasing after `20260913120000`, all idempotent (`ADD COLUMN IF NOT
EXISTS`; `DROP CONSTRAINT IF EXISTS` before every `ADD CONSTRAINT`; every `CREATE OR REPLACE` guarded).
⚠ Wave A's **seven are still unapplied and replay has never run.** Nothing here may be applied to
production before those are, and `20260907130000` may never be applied at all.

---

## 6. Measurable targets, and the gates that pin them

| Metric | After Wave A (A14, measured) | Target after Wave B | Pinned by |
|---|---:|---:|---|
| **Served per external connection** | 51,996 ch | **≤30,000** | `tool-budget.test.ts` ratchets, lowered in the commit that earns them |
| ↳ 13 descriptions | 16,092 | ≤8,000 (11 tools) | description ratchet |
| ↳ 13 input schemas | 34,053 | ≤19,000 | schema ratchet |
| ↳ `dopl_channel` desc / schema | ~1,120 / 11,609 | **620 / 3,000** | schema ratchet |
| ↳ `instructions` written = delivered | 1,851 | ≤1,900 | `instructions-budget.test.ts` |
| Doctrine (**pulled**) | 32,551 | **≤9,000** | `DOCTRINE_CEILING` + per-section caps |
| Tools served | 13 | **11** | `parity.test.ts` |
| `dopl_channel` ops / params | 23 / 35 | **5 / ≤20** | `parity.test.ts` + schema ratchet |
| Total params across the surface | 173 pre-wave (re-derive) | **≤100** | schema ratchet |
| **Turn 1, `full` windowless** | ~73,500 ch / ~18.4k tok (A5's capture; not re-run at integration) | **≤55,000 / ~13.5k tok** | SDK capture in `session-profiles.test.mjs`, wire list asserted **by name** |
| **Wake / tool turn** | ~60,700 / ~15.2k | **≤46,000 / ~11.5k** | same |
| **RLS-covered tables** — read caller-scoped, with a redteam test proving a non-member gets zero rows | **0** (all 406 reads via `supabaseAdmin()`) | **7** (`knowledge_bases`, `knowledge_entries`, `knowledge_folders`, `skills`, `agent_templates`, `chats`, `resource_grants`) | one redteam test per table + the `canSee*`↔policy pair gate |
| Prompt-only guardrails NONE/PARTIAL | 6 | **1** — G18's web residual, kept by ruling | one test per closed row |
| **Lines deleted (net)** | ~900 in Wave A | **≥3,000** | `size-check` + a per-slice deletion ledger in each commit body |
| Drift gates | 5 + `check-css-token-drift` | 3 + CSS — `check-knowledge-type-drift`'s shelf family (9 sites) and `check-role-drift`'s `dist/` arm retire with their subjects | the gates' own mutation tests |

**Three measurement rules, unchanged and re-asserted.** (1) Re-derive; never quote — the description
ratchet's downward half asserted nothing until 2026-09-02, and the profile table has been contradicted
by the wire (C7). (2) A green `check-doc-refs.mjs` proves a symbol is not a ghost; it does not prove it
is exported. (3) **This file lives in `docs/specs/`, which `check-doc-refs.mjs` does NOT scan** (scope:
`docs/*.md`, non-recursive). Its anchors were verified by hand against `523bfc92` and nothing will catch
them rotting.

---

## 7. Open question — one

**Who pays for work in a link or personal container?** B10 deletes the lookup that
`billing/server/credits-service.ts:91-114` uses today: a link-container burn reroutes to *the owner's
default workspace*, which after this wave has no definition. Three answers, and the difference is
commercial, not architectural:

(a) **the owner's sole owned standard workspace, refusing on ambiguity** — preserves who pays today,
adds a refusal where the code currently guesses;
(b) **the owner's personal container**, which now always exists and can carry its own `workspace_billing`
row — one rule, no count, no default, but a home-channel burn stops landing on the paid plan;
(c) an explicit `workspaces.billing_workspace_id`, set at container creation — exact, and a column.

**Default taken so the wave is not blocked: (a)**, as `findSoleOwnedStandardWorkspace`, because it is
the only one that changes no one's bill. One function reverses it.

Everything else in the rulings resolved without ambiguity. Four places where a ruling forced a decision
and the decision is recorded rather than asked: the default responder stores a **handle**, not a
template id (no FK across visibility — `20260823130000`'s own argument); `help` lives on **`rooms`**, so
the op count stays five and Wave A ruling 14 survives; **signup still seeds a standard workspace**,
which is no longer a default but a first workspace; and the personal container is **not in the rail** —
it has its own surface, `/home`, and appears in `dopl_workspaces` with its `kind`.
