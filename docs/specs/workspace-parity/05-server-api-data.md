# 05 — Server, API and data model: the HOME↔WORKSPACE parity substrate

**Area:** containers, routes, projections, caches, RLS, credits, MCP, realtime, desktop main.
**Worktree:** `sie-parity`, branch `docs/workspace-parity`, at `03506fcd`.
**Measured:** 2026-09-17. **Read-only audit — nothing in this document has been built.**

> ⚠ **LINE NUMBERS ARE A MEASUREMENT, THE SYMBOL IS THE REFERENCE.** CLAUDE.md's
> standing rule forbids a bare line number in a doc because it is wrong within a
> day. This document was asked for `file:line` evidence, so every citation is
> written `path › symbol` **(L123 @ 03506fcd)` — the anchor is durable, the
> number is dated. Re-derive with the symbol, never with the number.

> ⚠ **THIS IS THE SUBSTRATE HALF ONLY.** The UI/host-contract audit is a
> separate document. What is claimed here is what the SERVER, the API surface,
> the data model and the client cache layer do today, and what one
> implementation per feature would have to look like underneath a UI host
> contract.

---

## §0 Vocabulary — "home" names FOUR different things, and that is the first bug

Nothing in the parity work is legible until these are separated. All four are live
in the tree today and three of them appear in the same files.

| Word as used in the tree | What it actually is | Anchor |
|---|---|---|
| **home space / `/home`** | The desktop's ACCOUNT surface: a five-tab face that spans every container the user is in. Not a workspace at all. | `apps/desktop-ui/src/components/app-shell/account-rail.tsx › HOME_PATH` (L12), `src/features/home/tabs.ts › HOME_TABS` (L51) |
| **home channel** | A `workspaces.kind='link'` container holding exactly ONE channel and 1..N members. A real workspace row with a real membership. | `docs/INVARIANTS.md` §4A; `src/features/home/types.ts › HomeChannel` (L43) |
| **home workspace** | ⚠ **A DEAD WORD — THIS ROW WAS WRONG WHEN IT WAS MEASURED AND R-35 RETIRES THE CONCEPT** (corrected 2026-09-17). It said *"the caller's DEFAULT STANDARD workspace, answered by `POST /api/boot › workspace`"*. `getBootState`'s no-segment branch calls `ensurePersonalContainer` and has since wave B B14, so what boot answers is the **home shelf** row below — a `kind='personal'` container, never a `kind='standard'` row. Samuel's ruling R-35 (2026-09-17) makes that the rule rather than a leftover: a new account gets a home space and no standard workspace. **Do not reintroduce this sense of "home".** | `src/features/workspaces/server/segment.ts › getBootState`, `› ensurePersonalContainer`; `docs/INVARIANTS.md` §4A |
| **home shelf (`?shelf=home`)** | The caller's `kind='personal'` container — one per user. | `src/shared/tenancy/personal-container.ts › resolveShelfScope` (L227) |

⚠ **THREE ARE LIVE, NOT FOUR (2026-09-17, R-35).** The "home workspace" sense named a row
`POST /api/boot` stopped answering at wave B B14, and R-35 retires the concept outright — a new
account gets a home SPACE and no standard workspace at all, so there is no default standard
workspace for the word to mean. The heading's count is left standing because the word still appears
in the tree in that sense; it is a bug to fix, not a meaning to keep.

Consequences already visible in the code:

- `src/features/agent-templates/server/repository.ts › listHomeScopedTemplateIds` (L77)
  and `src/app/api/agent-templates/route.ts › homeScopedTemplateIds` (L59) are named
  for a **dropped column** (`home_scoped`) and answer a **container** question.
- `src/features/onboarding/server/service.ts › HOME_PATH` (L18) is a hand copy of the
  SPA constant and its own docblock calls itself *"a FOURTH hand copy"*.
- `src/app/api/home/*` is the ACCOUNT surface's API, but `/api/home/channels` lists
  LINK containers only — it does not list the personal container and does not list
  standard-workspace channels.

🔑 **Any host contract must name the axis it keys on — CONTAINER KIND — and stop
using the word "home" for it.** The kinds are the closed set
`@dopl/contracts › WorkspaceKind` = `"standard" | "link" | "personal"`
(`packages/contracts/src/workspaces.ts`), and the one predicate is
`src/features/workspaces/types.ts › isStandardWorkspace` (L89), positive form, with a
hand mirror at `packages/dopl-client/src/types.ts › isStandardWorkspace` (L104).

---

## §A Fork inventory

Classification key:
- **shared-already** — one implementation, both kinds go through it. Nothing to do.
- **forked-should-collapse** — two implementations of one concern; the difference is accidental.
- **host-adapter** — genuinely differs, and the difference is a capability the host should supply to one implementation.
- **host-specific-in-kind** — genuinely differs and must stay branched (the members/roles class Samuel named).
- **home-only** / **workspace-only** — exists on one side; parity decision required.

### A.1 Container identity and resolution

| # | Concern | Home path | Workspace path | Same code? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|
| A1 | Container kind predicate | `features/workspaces/types.ts › isStandardWorkspace` (L89) | same | ✅ yes | shared-already | none — but the hand mirror in `packages/dopl-client/src/types.ts › isStandardWorkspace` (L104) is F-295 debt | low |
| A2 | Kind-keyed LABEL | `packages/mcp-server/src/workspace-directory.ts › containerKind` / `› containerKindLabel` (L218, L224) | same `switch` | ✅ yes | shared-already | the `switch` (not `!isStandardWorkspace`) is the right shape — copy it into the web tree instead of inventing a second | low |
| A3 | Workspace listing (`GET /api/workspaces`) | UNFILTERED by contract — carries link + personal containers | same route | ✅ yes | shared-already | ⚠ **do not filter at the route** — `dopl-desktop-app/main/channel-listener.js` fans over this exact list (INVARIANTS §4A) | 🔴 high if "tidied" |
| A4 | UI filtering of that list | 7 consumers, all through `isStandardWorkspace` | same | ✅ yes | host-adapter | the filter is the HOST's decision; make it a host capability rather than a predicate call in 7 files | medium |
| A5 | Address resolution for MCP | `workspace-directory.ts › resolveWorkspaceRef` — deliberately DOES NOT filter | same | ✅ yes | shared-already | asymmetry is the feature: `workspace=<container id>` is how an agent addresses a home channel | low |
| A6 | Auto-target on ambiguity | `features/workspaces/server/service.ts › resolveActiveWorkspace` step 3 — standard only | same | ✅ yes | host-specific-in-kind | a container is never auto-targeted; this is correct and must survive | low |
| A7 | Route floor | `withUserAuth` (no `X-Workspace-Id`) on every `/api/home/*` | `withWorkspaceAuth`, default `minRole: "viewer"` (`src/shared/auth/with-workspace-auth.ts` L133) | ❌ no | forked-should-collapse | the account surface needs a USER-fenced read; see §B collapse 1 | medium |

### A.2 Channel list — THREE projections of one question

This is the single largest fork in the substrate: *"which channels am I in, and what
is their state"* is answered by three different types, off three different routes,
into three different client caches.

| # | Concern | Home path | Workspace path | Same code? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|
| A8 | Channel list DTO | `features/home/types.ts › HomeChannel` (L43) — 15 fields | `features/channels/types.ts › Channel` (L180) — 26 fields | ❌ no | forked-should-collapse | one `ChannelRow` + host-selected field set | 🔴 high |
| A9 | …third projection | — | `features/channels/types-account.ts › AccountChannelStatus` (L44), account-wide, kind-agnostic | ❌ no | forked-should-collapse | **this one already spans both kinds** and is the model to generalise | medium |
| A10 | Favourite / pin | `HomeChannel.favoritedAt` (L186) | `Channel.myFavoritedAt` (types.ts L213) | ❌ names differ, ✅ same column | forked-should-collapse | ONE wire name. Same row: `channel_members.favorited_at`, one writer (`channels/server/service-writes-members.ts › updateMyMemberSettings`) | medium — already caused a user-visible bug, see §B |
| A11 | Unread dot | `HomeChannel.unread` (L148) ← `home/server/unread-tally.ts › isChannelUnread` | `Channel.unread` ← `channels/server/dto.ts › mapChannelRow` | ❌ two computations, same watermark | forked-should-collapse | `isChannelUnread` is already *"`mapChannelRow`'s rule with the `isMember` clause moved to the caller"* (types.ts L136) — collapse to one | medium |
| A12 | Unread MENTION badge (`@ N`) | `HomeChannel.unreadMentions` (L164); `home/server/repository-unread.ts › listMyMentionStamps` | **ABSENT** | ❌ | **home-only** | the workspace channel list has no mention count at all. Parity item #1 | — |
| A13 | Roster on the row | `HomeChannel.peers` / `.peer` (L93, L113) | `Channel.memberCount` + `Channel.infoCard` | ❌ | host-adapter | home renders faces, workspace renders a count; one `members: {count, sample[]}` covers both | low |
| A14 | Pending invite chip | `HomeChannel.linkOut` (L192) | — | ❌ | **home-only** | a workspace's equivalent is `workspace_invitations` / `workspace_join_links`, which are never folded onto a channel row | low |
| A15 | Last-message preview | `HomeChannel.lastMessagePreview` (L128) — on the wire, **rendered by nothing** since 2026-09-13 | `Channel.lastMessageAt` only | ❌ | forked-should-collapse | dead field kept alive only by the SDK mirror `packages/dopl-client/src/home-types.ts` + committed `dist/` | low |
| A16 | Channel CREATE | `home/server/service-writes.ts › createHomeChannel` (L79) — mints container, then calls the shared `createChannel` | `features/channels/server/service › createChannel` | ✅ **the channel half is shared** | shared-already | ✅ the model: the home path adds a CONTAINER MINT and reuses everything else | low |

### A.3 Overview / analytics

| # | Concern | Home path | Workspace path | Same code? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|
| A17 | Overview payload | `features/home/overview-types.ts › HomeOverview` (L249): `channels[]`, `people[]`, `tools[]`, `agents[]`, `scanned`, `truncated` | `features/workspaces/types.ts › WorkspaceOverview` (L187): `counts{4}`, `activity[]`, `memberLoad{}` | ❌ **entirely different** | **home-only (content)** | there is no shared line at all — two feature trees, two repositories, two services | 🔴 high |
| A18 | Overview route | `GET /api/home/overview` — `withUserAuth`, cross-container, `?range=24h\|7d\|30d\|month` | `GET /api/workspaces/[slug]/overview` — `withUserAuth` + `resolveApiWorkspace`, **no range at all** | ❌ | forked-should-collapse | same resource at two scopes; see §B collapse 2 | medium |
| A19 | Series route | `GET /api/home/overview-series` — `metric=credits\|mcp\|messages`, `range`, `&channel=`, `&month=` | `GET …/overview-series` — `metric=messages\|mcp\|threads`, fixed 31-day UTC, `&channelId=` | ❌ | forked-should-collapse | **the metric SETS overlap but do not match** (`mcp`, `messages` in both; `credits` home-only; `threads` workspace-only) | 🔴 high |
| A20 | Credits on the series | home `credits` arm sums `credit_usage_events` by `payer_user_id = caller AND wallet='personal'` (`home/server/overview-tally.ts › isPersonalWalletBurn`) | **no credits metric** | ❌ | **home-only** | a workspace's seat-wallet burn has no histogram | — |
| A21 | Token-spend strip | `GET /api/home/token-spend` → `channels/server/service-token-spend.ts › readTokenSpend`, own-scoped, fixed 31d | **ABSENT** | ❌ | **home-only** | the table (`workspace_token_spend`, `20260927120000`) IS workspace-keyed; only the route is home-only | low |
| A22 | Live agent board | `HomeOverview.agents` → `HomeAgentRow` (L209), PUBLIC columns only | `WorkspaceOverview.counts.agentsRunning` (an integer) | ❌ | **home-only** | the operator-only telemetry fence (`20260822150000`) is the reason the home row is narrow; a workspace board inherits the same fence | medium |
| A23 | Range switcher | `home/overview-types.ts › HOME_OVERVIEW_RANGES` (L42) | none — 31 days, hardcoded | ❌ | host-adapter | range is a parameter of ONE series implementation; the host picks which ranges it offers | low |
| A24 | Activity feed | — | `WorkspaceOverview.activity`, viewer-filtered via `workspaces/server/repository-overview.ts › listVisibleChannelRefs` | ❌ | **workspace-only** | /home has `person-thread-activity.tsx` instead, off a different read | low |
| A25 | Member-load card | — | `WorkspaceOverview.memberLoad` | ❌ | **workspace-only** | home's `people[]` is the same question measured in CREDITS instead of messages | low |

### A.4 Shelves, knowledge, templates, ontology

| # | Concern | Home path | Workspace path | Same code? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|
| A26 | Shelf resolution | `shared/tenancy/personal-container.ts › resolveShelfScope` (L227) | same function | ✅ **yes** | **shared-already** | 🏆 **THIS IS THE TARGET SHAPE.** One function, one fence, `shelf` as a parameter, an EMPTY list as the fail-safe. §G builds on it | low |
| A27 | Shelf-bound INSERT | `personal-container.ts › personalWriteWorkspaceId` (L281) | same | ✅ yes | shared-already | refuses (`PersonalContainerMissingError`) rather than falling back | low |
| A28 | KB list | `GET /api/knowledge/bases?shelf=home` | `?shelf=workspace` (or absent) | ✅ ONE route | **shared-already** | 🏆 the endpoint collapse §B asks for, already done once | low |
| A29 | Template list | `GET /api/agent-templates?shelf=home` | `?shelf=workspace` | ✅ ONE route | shared-already | 🏆 same pattern | low |
| A30 | Template visibility scopes | `agent-templates/lib/visibility.ts › SECTIONS_CONTAINER` (2 options) | `› SECTIONS` (3 options incl. `team`) | ❌ two arrays, ONE module | **host-adapter** | already parameterised: `components/template-editor.tsx › TemplateEditorProps.containerKind` (L111) + `› sections` (L227). 🏆 the in-kind difference expressed as a PROP | low |
| A31 | Team scope gate | `agent-templates/server/service-write-gates.ts › assertTeamScopeGrantable` | same | ✅ yes | host-specific-in-kind | `lib/visibility.ts › offersTeamScope` is `=== "standard"`, positive | low |
| A32 | Channel-lane KB read | `GET /api/channels/[channelId]/knowledge/bases` — grant-table only, guest-reachable | same route | ✅ yes | shared-already | kind-agnostic by construction (it asks the GRANT, never the workspace role) | low |
| A33 | Ontology audience | `ontology/server/service-audience.ts › computeAudience` (L127): `link`/`personal` → resolved from share rows | `standard` → **`unrestricted`** (L129) | ❌ two arms | **home-only (the fine-grained half)** | a standard workspace has NO per-cluster sharing: every member sees every board. Parity item #2 | 🔴 high |
| A34 | Ontology share table | `ontology_channel_shares` (`20261001120000_ontology_home_shares.sql`), keyed `(ontology, channel)`, three audience levels | **no equivalent** | ❌ | **home-only** | `docs/specs/home-ontology.md` §2 is the matrix; a workspace board has no matrix at all | — |
| A35 | Shared-publish acknowledgement | `workspaces/server/shared-publish.ts › assertSharedPublishAcknowledged` (L117): fires only for `kind === "link"` with 2+ active members | never fires | ❌ | **host-specific-in-kind** | correct as written — ⚠ note it asks `=== "link"` POSITIVELY, not `!isStandardWorkspace` | low |

### A.5 Member-add lanes

| # | Concern | Home path | Workspace path | Same code? | Class | Action | Risk |
|---|---|---|---|---|---|---|---|
| A36 | Add a person | `home/server/service-writes.ts › mintContainerLink` → `service-claim-bound.ts › claimBoundLink` (single-use token bound to the container) | `workspaces/server/invitations.ts › …` (L67) and `› join-links.ts` (L59, L94, L191, L301) | ❌ | **host-specific-in-kind** | the two doors are two proofs. Do NOT collapse | 🔴 high |
| A37 | Refusal on the wrong door | `workspaces/server/authz.ts › assertMemberAddable` (L73) — `LINK_CONTAINER_CLOSED`, and the MESSAGE branches on kind (L78) | same function | ✅ yes | host-specific-in-kind | ⚠ the predicate is NEGATIVE on purpose (a fence must inherit), the MESSAGE is positive (F-564) | low |
| A38 | Bound-claim bypass | `claimBoundLink` writes the member row itself, pinned as an ABSENCE by `workspaces/server/link-container-guard.test.ts` | — | — | host-specific-in-kind | ⚠ **do not "tidy" this through the shared guard** — the pin exists because no mock would catch it | 🔴 high |

### A.6 MCP surface

The whole MCP package reads `kind` in **exactly one place** —
`packages/mcp-server/src/workspace-directory.ts › containerKind` (L224) — and it has
**five** consumers, of which only **two are behavioural**. That is the healthiest fork
surface in the tree and the reason it is cheap to extend.

| # | Concern | Home behaviour | Workspace behaviour | Class | Action |
|---|---|---|---|---|---|
| A39 | Container lock arming | `factory.ts › …` (L186-191): arms iff `containerKind(active) === "home channel" && memberCount !== 1` | never arms — a multi-member standard workspace session sees the operator's WHOLE directory | **host-specific-in-kind** (today) → **ruling needed** | see §F R4 |
| A40 | Audience-change preview / confirm token | `tools/confirm-token.ts › resolveConfirmTarget` (L181, L188): shared `link` container ⇒ dry-run + token + `acknowledgeShared` | **no preview, no token, silent publish** — argued at `tools/knowledge-ops-write.ts` (L76-81, L247-248) | **home-only** | parity item #3 — see §F R5 |
| A41 | Container mint | `meta-tools.ts › op="create_home_channel"` (L120-136) | **there is no `create_workspace` op anywhere** | **home-only** | low-risk add, or a deliberate no |
| A42 | Address rendering | id only (`meta-tools.ts` L181-184; `instructions.ts` L114; `workspace-directory.ts` L301) | slug **and** id | host-adapter | one `address(row)` helper already exists in effect; keep | 
| A43 | `personal` kind | **zero behavioural branch anywhere** — excluded from the lock (L188) and from the confirm class (L181) | n/a | **gap** | a publish inside a personal container never previews; deliberate ("one member") but undocumented as a rule |
| A44 | Workspace vocabulary inside a container | `dopl_map` renders `"# Workspace map"` (`tools/map.ts` L110) and "this workspace" (L46); `dopl_members` renders `"You in <workspace>"` (`tools/members.ts` L162), `"No teams in this workspace"` (L272); the workspace-wide hold says "this workspace" (`channel-ops-hold-workspace.ts` L75, L77) | correct there | **forked-should-collapse (copy)** | one `containerNoun(kind)` through `containerKindLabel` |
| A45 | `?shelf=` on MCP | **does not exist** — no zod `shelf:` field in the package. The SDK still has `listKbBases(opts:{shelf?})` (`packages/dopl-client/src/knowledge.ts` L39-41) and **no MCP call site passes it** | same | forked-should-collapse | the shelf is resolved server-side (`resolveShelfScope`), so this is consistent — but the SDK param is now dead weight |
| A46 | `/api/home/*` via MCP | `getHomeChannels` is bound in the SDK (`packages/dopl-client/src/client-home.ts` L18-20) and **called nowhere** in `packages/mcp-server/src` outside tests | n/a | **home-only, unreachable** | `peers`, `peer`, `linkOut`, `pendingLinks` have no agent-facing surface |
| A47 | `workspace=` argument honour | honoured on 9 schema rows only (`workspace-arg.ts › …` L65-79); ignored elsewhere with a footer note (`registrar.ts` L388-389) and **slated for removal next release** (`workspace-arg.ts` L53-56) | same | **⚠ risk** | it is the ONLY way to address a container; its retirement is a home-facing break — see §F R6 |

### A.7 Realtime

| # | Concern | Home | Workspace | Class | Note |
|---|---|---|---|---|---|
| A48 | Subscription filter | `workspace_id=eq.<id>` | same | **shared-already** | `src/shared/realtime/shared-channel-registry.ts` (L176). A link container IS a workspace id, so every doorbell already reaches it |
| A49 | `channel_links` / `channel_link_claims` | **deliberately UNPUBLISHED and UNBOUND**; both migrations assert their own absence in a `DO $$`; `test/ui-sync-tables.test.mjs` pins the pair | n/a | host-specific-in-kind | the home surface REFETCHES on write instead. ⚠ `channel_links.workspace_id` is NULLABLE (legacy unbound link) so the row could not satisfy the workspace-scoping contract anyway |
| A50 | Home list liveness | no doorbell — `apps/desktop-ui/src/pages/home/use-home-unread-refresh.ts` invalidates `/api/home/channels` off the TRANSCRIPT cache entry | the channels doorbell (`channels/components/live.ts › useChannelsLive`) | **forked-should-collapse** | two liveness mechanisms for one list |

---

## §B Duplicate endpoints, caches and query keys — and the collapse plan

### B.1 What is duplicated today

| Pair | Home endpoint | Workspace endpoint | Client cache key (home) | Client cache key (workspace) | What each client reads |
|---|---|---|---|---|---|
| **Channel list** | `GET /api/home/channels` → `HomeChannelsPayload` | `GET /api/channels` → `{channels: Channel[]}` | `apiPathKey(HOME_CHANNELS_PATH)`, `HOME_CHANNELS_PATH = "/api/home/channels"` (`apps/desktop-ui/src/pages/home/home-rows.ts` L10) | `channelKeys.list()` → `apiResource("/api/channels")` (`src/features/channels/client/query-keys.ts › channelsPath` L22) | /home reads `peers`, `topic`, `favoritedAt`, `unread`, `unreadMentions`, `linkOut`; the channels page reads `myFavoritedAt`, `unread`, `memberCount`, `infoCard`, `role`, `visibility`, `isDirect`, … |
| **…and a third** | — | `GET /api/channels/account/status` → `AccountStatus` (**cross-container already**) | — | — | `dopl_channel(op="status")` and the Overview "Needs you" card |
| **Overview** | `GET /api/home/overview` | `GET /api/workspaces/[slug]/overview` | `apiPathKey("/api/home/overview")` | `apiQueryKey(…, {workspaceId})` | disjoint payloads (§A17) |
| **Series** | `GET /api/home/overview-series` | `GET /api/workspaces/[slug]/overview-series` | as above | as above | overlapping metric sets (§A19) |
| **Long-poll** | — (account read is a PAGE, not a hold: `api/channels/account/messages/route.ts` says *"A PAGE, NEVER A HOLD"*) | `GET /api/channels/await` (workspace-wide) and `GET /api/channels/[channelId]/await` | — | — | the account surface has no cross-container hold |

### B.2 The concrete cost, already paid once

🔴 **The pin/bookmark bug is the worked example, and it is in the tree as a comment.**
`apps/desktop-ui/src/pages/home/use-home-channel-sync.ts` (L23-34) records Samuel's
2026-09-15 report — *"the bookmark icon like alway breaks and is super buggy"* — and
names the cause exactly:

> the pin **"lives in TWO client caches and the write only ever told one of them"**

The fix is a 113-line cache-to-cache MIRROR (`› useHomeChannelSync`, L58-113) that
subscribes to the `/api/channels` cache and copies `myFavoritedAt → favoritedAt`,
`name`, `topic` into the `/api/home/channels` entry. It cannot live in the write
(`channels → home` is a forbidden import, INVARIANTS §1), it must PATCH rather than
invalidate (optimistic pin), it must copy-never-invent (partial optimistic entries),
and it must return `prev` on no-change (the transcript fires several times a minute).
**Every one of those rules exists only because there are two caches.** A second such
bridge already exists beside it (`use-home-unread-refresh.ts`), and its docblock says
*"`use-home-unread-refresh.ts` drew this line first"* (L34).

### B.3 Collapse plan

**Collapse 1 — ONE channel-list resource, container-kind as a parameter.**

- Keep `GET /api/channels` as the single route. Add `?scope=container|account`:
  - `scope=container` (default) — today's behaviour, `withWorkspaceAuth`, `X-Workspace-Id`.
  - `scope=account` — the USER fence (`withUserAuth`), spanning every container the caller
    is a member of, of every kind. **The fence already exists and is already written
    twice**: `home/server/service-reads.ts › getHomeChannels` (L253) and
    `channels/server/repository-account.ts › listAccountChannelRefs`. Use the second.
- One DTO. `Channel` is the superset; the home-only fields fold onto it:
  `unreadMentions` (A12), `peers`/`peer` (A13, as `members.sample`), `linkOut` (A14),
  `container: {id, kind, segment}`.
- **Rename `myFavoritedAt` → the one name, everywhere, in one change.** Two names for
  `channel_members.favorited_at` is the whole of the pin bug.
- **Then `use-home-channel-sync.ts` and `use-home-unread-refresh.ts` DELETE.** They are
  bridges between two caches; one cache needs no bridge.
- ⚠ **Migration hazard:** `/api/home/channels` is IndexedDB-persisted with a 24h
  `gcTime` and the §8 stale-cache rule applies to every key (`home/types.ts` documents
  `?? EMPTY_PEERS`, `?? ""`, `?? false`, `?? 0`, `?? null` per field). A cut-over must
  either keep the old path answering for one release or bump the version gate (§13).

**Collapse 2 — ONE overview resource, scope as a parameter.**

- `GET /api/overview?scope=account` | `?scope=container&workspace=<seg>` with a shared
  `range` vocabulary. The two payloads are today disjoint, so this is **a build, not a
  merge**: the honest first step is to name the union and decide per-section which
  host renders it (§F R2).
- The SERIES is the cheaper half and should go first: both routes already agree that
  *"metric is a query PARAMETER the user switches"* and both 400 an unknown metric.
  One `metric` union (`messages | mcp | threads | credits`), one `range` union, one
  zero-fill rule, one `truncated` flag. The fences differ and stay:
  `isChannelVisibleTo` for a workspace channel, the caller's own container list for an
  account read.

**Collapse 3 — ONE clipped/ceiling vocabulary.** /home's three ceilings
(`HOME_CHANNEL_LIMIT` 200, `HOME_LINK_LIMIT` 50, `HOME_MENTION_SCAN_LIMIT` 500,
`home/server/service-reads.ts` L33/L35/L46) are **non-reporting by sanction**; the
workspace reads report `truncated`. A merged list read must pick one, and §9 says the
answer is `truncated` + a fifth wording.

**Collapse 4 — the shelf pattern is already the answer for the resource lists.**
`?shelf=home|workspace` on `/api/knowledge/bases` and `/api/agent-templates` is ONE
route serving both kinds, with `resolveShelfScope` as the only fence. **Do not build a
second pattern for channels and overview — extend this one.**

---

## §C Data-model differences

> **Headline: the DATA MODEL is kind-aware; RLS is NOT.** Not one SELECT policy
> in `supabase/migrations/**` reads `workspaces.kind`. Every fence is
> `is_current_workspace_member(workspace_id, …)` or `is_channel_member(channel_id)`
> — membership-only, kind-blind
> (`20260720211005_rls_pin_workspace_member_and_initplan.sql` L80-91;
> `20260725120000_channels.sql` L92-105). **RLS parity is already achieved by
> construction.** What is unequal is (a) which tables exist at all and (b) which
> code paths branch on kind.

### C.1 Tables/columns that serve one kind

| Table / column | Migration (file:line) | Kind served | Standard equivalent? | Parity need |
|---|---|---|---|---|
| `workspaces.kind` | `20260823150000_home_link_channels.sql` L95-96 | the discriminator | n/a (`DEFAULT 'standard'`) | **no index on it, deliberately** (L62) |
| `channel_links` | `20260823150000` L117-128 | **link** | `workspace_invitations` / `workspace_join_links` | no — different proof, both correct |
| `channel_links.workspace_id` | `20260824120000_home_channel_containers.sql` L104-106 | **link** (binds a token to an existing container) | — | no. ⚠ **NULLABLE by design** (legacy unbound link) |
| `channel_link_claims` | `20260823150000` L150-161 | **link** | — | no |
| `consume_channel_link(uuid)` RPC | `20260823150000` L200 | **link** | — | no |
| `channel_personal_arming` | `20260925120000_channel_personal_arming.sql` L38-48 | **personal** | — | 🔴 **DEAD.** Samuel reversed task 11 on 2026-09-06; `src/shared/tenancy/personal-reach.ts` (L14-18) records that nothing writes it. Three live policies (L66, L75, L93) still count against the RLS surface. **Drop candidate, not a parity item** |
| `workspace_token_spend` | `20260927120000_workspace_token_spend.sql` L75-127 | **schema kind-agnostic, reader home-only** — fenced per OPERATOR (`user_id`) | none | ✅ **yes, if Overview ships for workspaces** — the table already works; what is missing is a workspace-side read surface **and a ruling** (L149-153 says it is *"DELIBERATELY NARROWER"* because a member-scoped read leaks a colleague's spend) |
| `credit_usage_events.origin_workspace_id` | `20260901130000_credit_usage_events.sql` L73 | the /home read's dimension | `workspace_id` arm is the standard path | already parity |
| `credit_usage_events.wallet` / `.payer_user_id` | `20260930120000_credit_wallets.sql` L335, L354; CHECK `('workspace','personal','seat')` L346 | splits home vs seat | `seat` | already parity |
| `user_credit_usage` | `20260930120000` L119-125 | **personal + owned-link** | `workspace_member_credit_usage` L156-163 | ✅ **already symmetric — the one place the two kinds got matched pairs** |
| `workspace_billing.plan` CHECK | `20260930130000_workspace_billing_plan_pro.sql` L92-96 | adds personal-Pro | L39-47: a personal container *"is already a real `workspaces` row"*, so checkout/webhook/portal needed **zero** schema change | already parity 🏆 |
| `knowledge_bases.home_scoped` | `20260831120000_knowledge_base_home_scoped.sql` L96 | personal-shelf marker | none | **redundant — see C.2** |
| `agent_templates.home_scoped` | `20260901120000_agent_template_home_scoped.sql` L93 | same | none | same |
| `ontology_channel_shares` | `20261001120000_ontology_home_shares.sql` L149 | **link only**, enforced by TRIGGER | none — a standard workspace reaches an ontology by membership (arm 1, "unrestricted") | 🔴 **the biggest one-way gap. Needs a ruling (§F R3)** |
| `mcp_tokens.container_id` / `.subject_user_id` | `20260917120000_mcp_token_credential_axes.sql` L135-137, L147-149 | kind-agnostic | same column | no gap |
| `mcp_tokens.workspace_lock_kind` | `20260829120000` L83, CHECK L90-91 | legacy, superseded (L152), retires in B13 | — | pending cleanup |
| `channel_members.favorited_at` | `20260819120000_channel_members_favorited_at.sql` L106 | **kind-agnostic** | identical | **no DB gap — the fork is two wire names, §A10** |
| `channel_mention_reads` | `20260818140000` (workspace guard L91) | kind-agnostic | same | no DB gap — **the fork is that only /home computes a badge from it (§A12)** |
| `resource_grants` | `20260914120000_resource_grants.sql` L168-192 | **kind-agnostic by design** | — | ✅ see C.4 |
| `workspaces_personal_owner_uidx` | `20260920120000_workspace_kind_personal.sql` L186-187 | **personal** (partial unique on `owner_id WHERE kind='personal'`) | none needed | correct |
| `ensure_personal_container(uuid,text)` | `20260920120000` L232-311 (re-declared `20260922120000` L109) | **personal** | `ensure_default_workspace` was the standard twin — **DROPPED** (`20260922120000` L183) | asymmetric on purpose |
| `default_workspace_of(uuid)` | `20260920120000` L198-207 (`kind='standard'` L204) | **standard** | — | *"born deprecated"* (L209-210); **DROPPED** `20260922120000` L179 |

**Deleted one-kind objects (for completeness):** `channel_resource_grants` (created `20260827120000` L111, dropped `20260923130000` L126) and its trigger/function/policy stack; `agent_template_teams` (`20260915120000`); `team_resource_access` (`20260916120000`); `enforce_link_container_member_cap` (see C.5).

### C.2 `home_scoped` — the redundant copy, and the one held migration

- Carried by **two** tables: `knowledge_bases.home_scoped` (`20260831120000` L96) and
  `agent_templates.home_scoped` (`20260901120000` L93). `BOOLEAN NOT NULL DEFAULT FALSE`,
  **no index on either**.
- Migrated out by `20260920120000_workspace_kind_personal.sql` §5 (L384, L392).
- **Nothing in `src/` or `dopl-desktop-app/main/` reads it.** The only live references
  are tests asserting its ABSENCE. The API sibling keys `homeScopedBaseIds` /
  `homeScopedTemplateIds` survive **by name only** and answer from the personal
  container (`src/app/api/agent-templates/route.ts` L27-28;
  `src/features/agent-templates/server/repository.ts` L81).
- Dropped by the HELD `supabase/migrations-held/20260923120000_drop_home_scoped.sql`
  (L112-113). **Preconditions, from `supabase/migrations-held/README.md`:** P1 (the
  one-time move) and P2 (the flag) are struck through as DONE; **the live gate is
  step 3 — two `count(*)` queries must return 0**, and the file's own `DO $$`
  (L61-104) RAISEs otherwise, which aborts a `db push` batch part-way. ⚠ **The
  column is also the rollback path; once dropped the deploy is one-way.**

🔑 **Parity consequence:** the personal shelf is already a TENANCY, not a flag. Any
parity work that reintroduces a boolean "which surface lists this" column is
re-opening a finding that has already been closed twice (F-333 / F-336 class).

### C.3 The `workspaces.kind` CHECK — every touch, in order

1. `20260823150000_home_link_channels.sql` L95-96 — `ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard'`.
2. `20260823150000` L98-109 — `CHECK (kind IN ('standard','link'))` (the `ADD` at L106).
3. *(comment only)* `20260824120000` L187 — restated after the bind inversion.
4. *(comment only)* `20260830120000` L95 — restated after the member cap dropped.
5. `20260920120000_workspace_kind_personal.sql` L175-177 — drop and re-add as `CHECK (kind IN ('standard','link','personal'))`.

**Two structural touches, three comment rewrites. No fourth value has ever been proposed.**

### C.4 `resource_grants` — the cross-container lending model, and it is symmetric

- `supabase/migrations/20260914120000_resource_grants.sql` L168-192. Generalises the
  dropped `channel_resource_grants` **and** `team_resource_access` into one table.
- 5 resource types (`knowledge_base`, `agent_template`, `skill`, `chat`, `chat_folder`,
  L171-172) × 3 scope types (`channel`, `container`, `team`, L169). `workspace_id` is
  **the resource's container, never the scope's** (L174-175). Two level vocabularies
  in one column, discriminated by scope (L183-188): channel scopes take
  `agent_only|visible`, container/team scopes take `read|edit`.
- **Cross-container reach is bought with an AUTHOR** (L273-286): an unattributed grant
  may not cross containers; an attributed one requires the grantor to be a `viewer` of
  **both** containers. Symmetric refusals.
- 🏆 **Nothing in the table, the CHECKs, `enforce_resource_grant` (`20260921140000`
  L245-326), `dopl_grant_admits` (`20260923140000` L107-130) or the policies (L204-228)
  reads `workspaces.kind`.** A standard workspace can lend into a personal container
  and vice versa. **This is the target shape for every future sharing feature.**

### C.5 Kind-specific triggers and functions — there is exactly ONE left

| Object | Migration | Kind clause | Status |
|---|---|---|---|
| `assert_ontology_share_scope()` + `ontology_channel_shares_assert_scope` | `20261001120000` L207-243, trigger L250-252 | `IF v_channel_kind <> 'link' THEN RAISE` (L235-239) | ✅ **the only live kind-specific trigger in the schema.** ⚠ note L204-206: `= 'link'` is the POSITIVE form; `<> 'standard'` would silently admit `personal` |
| `enforce_link_container_member_cap()` | created `20260824120000` L129-182 (kind read L148-155) | link | 🔴 **DROPPED** by `20260830120000_link_container_multi_member.sql` L89-90. ⚠ **`src/features/workspaces/server/authz.ts` (L52-53) still says *"The hard fence under both is the database — `enforce_link_container_member_cap`"* and still describes a TWO-MEMBER CAP (L35-38). That comment has been false since 2026-08-30** — see §F F-note |
| `enforce_resource_grant()` | `20260914120000` L237-294, redefined `20260921140000` L245-326 | **none** | kind-agnostic |
| `ensure_default_workspace` | `20260823160000` L73-84 (`kind='standard'` L76, L81) | standard | **DROPPED** `20260922120000` L183 |
| `ensure_personal_container(uuid,text)` | `20260920120000` L232-311 | personal | live. ⚠ **owner membership insert L305-306 is not optional** — every read fence asks about MEMBERSHIP, not ownership |
| ~10 `*_workspace_guard` triggers on channel children | e.g. `20260725130000` L100/L105; `20260822160000` L222; `20260903120000` L224 | **none** — child's `workspace_id` must match its channel's | kind-agnostic, applies identically to all three kinds |

### C.6 RLS — the pair gate

- **`scripts/check-rls-pair-gate.ts`** — the pairing registry is the in-file
  `COVERED` map (L86-204), keyed by table. Four checks (L326-390): predicate-set
  EQUALITY against a regex discovery of `export function canSee*` (L225-234, L326-339);
  a migration REPLAY ordered by character offset (L269-317) asserting RLS still enabled
  (L345-350); live SELECT-policy set EQUALS the declared set (L352-376); each policy is
  `FOR SELECT`, reaches its predicate, and is not `USING (true)` (L378-389).
- Its own stated limit (L39-44): **"IT STILL DOES NOT CLAIM THE TWO AGREE."**
- **Seven `canSee*` predicates, none kind-specific.** `canSeeOntology`
  (`src/features/ontology/server/service-shared.ts` L134) *narrates* `personal` in its
  docblock but the branch lives in `service-audience.ts › computeAudience` (L129).
- **Two redteam suites touch kind at all:**
  `src/features/knowledge/server/rls-redteam-personal-container.test.ts` (L31-57, mints
  via the RPC — *"never a hand-built row"*) and
  `src/features/ontology/server/rls-redteam.test.ts` (L272, the one `kind:"link"` fixture).
  **There is no standard-container counterpart because the standard case IS the baseline.**

### C.7 Deploy-state caveat

⚠ **Applied state is a MEASUREMENT (INVARIANTS §12) and this audit did not connect to
any database.** Join on the migration NAME, never the filename prefix — `20260823150000`
applied as `20260823205007`, `credit_usage_events` as `20260901193049` (F-304).

⚠ **`20260930120000_credit_wallets.sql` (L26-39) says both failure modes of deploying
the server ahead of it are SILENT**: `consume_*` missing → PGRST202 → the consume route
fails open and every tool call runs free and unmetered; the ledger insert → 42703
swallowed → the /home credit rails go quietly empty. **A parity wave that touches the
overview must not be the thing that discovers this.**

---

## §D Permission model — one-owner container vs multi-member workspace

### D.1 What a STANDARD workspace asks

| Question | Decision site | Mechanism |
|---|---|---|
| Are you in this workspace at all? | `src/features/workspaces/server/authz.ts › requireWorkspaceRole` (L15) | `findMembership` + `status === "active"`; **404, not 403** — existence is not an oracle |
| Are you senior enough? | same (L24) via `features/workspaces/types.ts › meetsMinRole` | `owner > admin > member > viewer > guest`, pure `>=`. `guest` is rank 0 |
| …at the route boundary | `src/shared/auth/with-workspace-auth.ts` (L133, L168) — default `minRole: "viewer"` | a `guest` clears only routes explicitly floored to `"guest"` |
| …on a `[workspaceSlug]` route | `features/workspaces/server/segment.ts › resolveApiWorkspace` (L220), `ApiWorkspaceOpts.minRole` (L34) default `"viewer"` (L158) | returns `null` ⇒ the route 404s |
| May you see this CHANNEL? | `channels/server/repository-visibility.ts › visibleChannelsOr` | per-channel membership + `visibility`; the SAME statement the overview's fence uses (`workspaces/server/repository-overview.ts › listVisibleChannelRefs`) |
| May you read this RESOURCE? | the seven `canSee*` predicates + their RLS twins | visibility ∥ creator ∥ admin ∥ **team grant** ∥ `resource_grants` |
| May a TEAM reach it? | `src/features/teams/server/access.ts › effectiveResourceAccess` (L33), `› requireEffectiveAccess` (L72), `› resolveLevel` (L193) | teams exist **only** in a standard workspace |
| May you add a member? | `workspaces/server/invitations.ts › createInvitation` (`requireWorkspaceRole(…, "admin")`), `› join-links.ts` | plus `billing/server/entitlements.ts › assertCanAddMember` (L305) |
| May you launch an agent here? | channel membership + the desktop's posture (`dopl-desktop-app/main/channel-prefs.js › POSTURE_KEY`, L341) | **keyed by CHANNEL ID, container-blind** |

### D.2 What a ONE-OWNER container asks — and where it shortcuts

| Question | `kind='link'` | `kind='personal'` |
|---|---|---|
| Membership | **the same rows, the same gate.** A link container is a real `workspaces` + `workspace_members` pair (INVARIANTS §4A) | same — and `ensure_personal_container` (`20260920120000` L305-306) **inserts the owner membership** precisely so every existing fence keeps working |
| Role floor | the same `meetsMinRole`. A claimer lands at the link's `granted_role` (default `guest`) | exactly one member, who is the owner |
| Add a member | **only** `home/server/service-claim-bound.ts › claimBoundLink` — a single-use token bound to that container. Every workspace-level path refuses (`authz.ts › assertMemberAddable`, L73) | **nobody, ever.** Same refusal, different sentence (L80) |
| Mint that token | `home/server/service-writes.ts › mintContainerLink` — `member`+ floor (`LINK_MINT_FORBIDDEN`) **plus** grant-above-self (`GRANT_ABOVE_SELF`) | n/a |
| Teams | none. `agent-templates/lib/visibility.ts › offersTeamScope` is `=== "standard"`; server fence `service-write-gates.ts › assertTeamScopeGrantable` | none |
| Who pays | the **container OWNER's** personal wallet, whoever called (`credits-service.ts › containerTarget`, L216-237) | the caller **is** the owner — the lookup is **skipped**, provably (L193-197) |
| Ontology reach | resolved from `ontology_channel_shares` per `(ontology, channel)` | resolved the same way; *"its only member is the OWNER, which is why 'a share never narrows the owner' needs no arm of its own"* (`20261001130000` L211-214) |
| Publish acknowledgement | `shared-publish.ts › assertSharedPublishAcknowledged` fires at **`kind==='link'` AND 2+ active members** | never |
| MCP credential lock | `packages/mcp-server/src/factory.ts` (L186-191): arms at `"home channel"` **and** `memberCount !== 1`; desktop twin `dopl-desktop-app/main/session-credential.js › shouldLockSession` (L78-82) | never |

🔑 **The shortcuts are all ONE shortcut, stated four ways: `memberCount === 1` ⇒ the
caller is the only audience.** It is spelled by hand in at least five places
(`credits-service.ts` L193, `factory.ts` L188, `session-credential.js` L80,
`session-audience.js` L83, `shared-publish.ts` L124) and **absent `memberCount` fails
CLOSED in the desktop three and OPEN in nothing**, which is the right direction.

### D.3 The minimal host adapter

Every question above reduces to **six** the substrate actually asks. A container-kind
adapter that answers these six covers both hosts with one implementation behind it:

```ts
/** What a container can DO — supplied by the host, consumed by one implementation. */
interface ContainerCapabilities {
  /** 'standard' | 'link' | 'personal' — the closed set, never derived by negation. */
  kind: WorkspaceKind;

  /** 1. ROSTER SHAPE. How many people can be in here, and how do they get in. */
  membership:
    | { model: "roles"; roles: Role[]; addVia: "invitation" | "join_link" }   // standard
    | { model: "token"; addVia: "bound_link"; mintFloor: Role }               // link
    | { model: "solo" };                                                       // personal

  /** 2. GROUPING. Does `team` exist as a grantable audience here? */
  offersTeamScope: boolean;            // === "standard" today

  /** 3. AUDIENCE SIZE. Is the caller the only possible reader right now? */
  isSoleAudience: boolean;             // memberCount === 1, fail-closed when unknown

  /** 4. WALLET. Whose credits move, and which counter. */
  wallet: { kind: WalletKind; payer: "caller" | "owner" };

  /** 5. ADDRESS. Slug + id, or id only. */
  address: { slug: string | null; id: string };

  /** 6. NOUN. What a person or an agent should be told this place is called. */
  noun: "workspace" | "home channel" | "personal container";
}
```

Mapping to what already exists — **four of the six are already one function**:

| Field | Already implemented as | Sites to collapse into it |
|---|---|---|
| `kind` | `features/workspaces/types.ts › isStandardWorkspace` (+ the `packages/dopl-client` mirror) and `packages/mcp-server/src/workspace-directory.ts › containerKind` | 2 predicate copies (F-295) |
| `membership` | `workspaces/server/authz.ts › assertMemberAddable` (the fence) + the two mint paths | already correct; **name it** |
| `offersTeamScope` | `agent-templates/lib/visibility.ts › offersTeamScope` 🏆 | already exactly this shape — generalise the file out of `agent-templates/` |
| `isSoleAudience` | **hand-spelled `memberCount === 1` in 5 places** | 🔴 collapse |
| `wallet` | `billing/server/credits-service.ts › containerTarget` 🏆 | already exactly this shape |
| `address` | `workspace-directory.ts › …` (L181-184, L301), `instructions.ts` (L114) | 3 copies of one rule |
| `noun` | `workspace-directory.ts › containerKindLabel` (L218) | **and ~8 hardcoded "Workspace"/"this workspace" strings in `tools/map.ts`, `tools/members.ts`, `channel-ops-hold-workspace.ts`** |

⚠ **The adapter must NOT answer "who may read row X".** That stays with the seven
`canSee*` predicates and their RLS twins, which are kind-blind and must remain so —
`src/features/agent-templates/server/service-shelf.test.ts › does NOT become a
visibility gate` is the pin that says so.

---

## §E Credits and billing — touchpoints the parity work must not break

1. **The wallet table is keyed on CONTAINER KIND and nothing else**
   (`src/features/billing/server/credits-service.ts` header, L33-44):
   `standard → seat / caller`, `personal → personal / caller (= owner, lookup skipped)`,
   `link → personal / container OWNER`, *no active owner → unmetered and logged*.
   Implemented once, in `› containerTarget` (L208-237).
2. **RULE B: the CALLING CHANNEL's container pays, not the addressed one**
   (Samuel 2026-09-13, `› resolveBillingTarget` L175). The channel arrives on the
   **forgeable** `X-Dopl-Session-Id` header and is honoured only when the caller is an
   ACTIVE MEMBER of that channel's container — `billing/server/channel-attribution.ts`
   (L23-41), which **fails open, never refuses**.
   🔴 **Any parity change that moves where a call declares its channel moves who pays.**
3. **The histogram must equal the wallet** (Samuel, same day, F-693). The ledger row is
   written **by the wallet RPC, inside the counter's transaction**, so there is no arm
   where a counter moves without a ledger row. `/api/home/overview-series`'s `credits`
   arm selects `payer_user_id = caller AND wallet='personal'` plus legacy
   `wallet='workspace'` rows whose origin container the caller OWNS
   (`home/server/overview-tally.ts › isPersonalWalletBurn`).
   🔴 **A merged overview series MUST NOT sum across wallets** — that was the exact bug
   the 2026-09-12 fix removed (a link container's burn *plus* a workspace's seat burn on
   one card, disagreeing with `GET /api/billing/status › credits.used` by construction).
4. **Two plan sets, picked by kind**: `features/billing/plans.ts › plansForKind` (L216),
   `personal → PERSONAL_PLANS`, everything else → `WORKSPACE_PLANS`.
   `webhook-plan.ts` (L66, L69) validates the pairing: `pro` requires `kind==='personal'`,
   `team` requires `isStandardWorkspace`.
   🔴 **A surface reading the wrong plan set badges a plan the container cannot hold.**
5. **`billing/server/status-service.ts › containerKind` (L116, L180)** is how a surface
   knows which figure it is looking at. ⚠ **§8 stale-cache: `containerKind` is absent on
   a row cached before 2026-09-08 and every read spells `?? "standard"`**
   (`billing/components/use-workspace-entitlements.ts` L133, L192-195).
6. **`entitlements.ts › assertCanAddMember` (L305)** carries a `pro`-plan arm
   (`PERSONAL_SINGLE_MEMBER`) described in its own docblock as *"a belt on top of
   braces"*: the membership writes are already fenced from containers upstream, and this
   must stay anyway.
7. **`/api/billing/status` is the credit BAR's source on both faces** — the home Overview
   reuses it and so does the workspace page. It is **always the CURRENT period** and is
   untouched by the home series' `channel`/`month` controls
   (`src/app/api/home/overview-series/route.ts` L34-35).
8. **The MCP refusal sentence carries a NUMBER across the wire**
   (`credits-service.ts › CreditConsumeResult.upgradeCredits`, F-668): the MCP package
   cannot import `../credits.ts`, so `upgradeCredits` is the one fact it is handed.
   Do not re-inline it.
9. **Cached payload fields with mandatory fallbacks** (INVARIANTS §8), all of which a
   parity refactor will touch: `HomeChannel.peers ?? EMPTY_PEERS`, `.topic ?? ""`,
   `.unread ?? false`, `.unreadMentions ?? 0`, `.myFavoritedAt ?? null`,
   `HomePendingLink.grantedRole ?? "guest"`, `WorkspaceListItem.memberCount ?? 0`
   (**fail-CLOSED, zero means "not solo"**), `containerKind ?? "standard"`,
   `KnowledgeBase list › channelGrants ?? EMPTY_GRANTS`, `chats › truncated ?? false`.

---

## §F Items needing Samuel's ruling

Each is a real fork where the code cannot pick for itself. Options, then a recommendation.

**R1 — Is the ACCOUNT surface a third host, or is it "the workspace host with `scope=account`"?**
This decides whether the collapse in §B is possible at all.
- (a) Account is a third host with its own endpoints (today's shape). Cost: every new
  channel-list field is built twice, forever; two caches and a bridge per fact.
- (b) One resource family, `scope=container|account` as a parameter; the fence differs,
  the projection does not.
- ✅ **Recommendation: (b).** `GET /api/channels/account/status` already spans both kinds
  with one type (`types-account.ts › AccountChannelStatus`), so the pattern is proven in
  this tree. `?shelf=home|workspace` on `/api/knowledge/bases` and `/api/agent-templates`
  is the same pattern proven twice more.

**R2 — Is a WORKSPACE Overview supposed to show credits, tokens and a live agent board?**
The two overview payloads are today **disjoint** (`WorkspaceOverview` = counts + activity
+ member-load; `HomeOverview` = credits by channel/person/tool + live agents + scanned).
- (a) No — a workspace Overview is an ACTIVITY page, /home is a SPEND page. Leave them apart.
- (b) Yes — one Overview with the same sections, host-selected.
- ⚠ **(b) has a privacy sub-question that must be answered in the same breath:**
  `workspace_token_spend` is fenced per OPERATOR *on purpose*
  (`20260927120000` L149-153: a member-scoped read *"would leak a colleague's spend"*),
  and `HomeAgentRow` deliberately carries **no** `model` / `toolLabel` / `tokensSpent`
  (`overview-types.ts` L209 block: *"a peer learns THAT an agent is working, never what
  it costs its operator"*).
- ✅ **Recommendation: (b) for the SERIES only, first.** Both series routes already agree
  metric is a switchable parameter and both 400 an unknown one; unify `metric`, `range`,
  zero-fill and `truncated`, keep the two fences. Defer the panels until R2's privacy half
  is ruled.

**R3 — Does a STANDARD workspace get per-ontology sharing?**
Today `ontology/server/service-audience.ts › computeAudience` (L129) answers
`unrestricted` for `standard` — **every member sees every board** — while a `link`
container has a full three-audience matrix per `(ontology, channel)`
(`ontology_channel_shares`, whose trigger `assert_ontology_share_scope` **RAISEs for any
kind but `link`**, `20261001120000` L235-239).
- (a) Keep it. A workspace board is workspace-wide by definition.
- (b) Extend the share row to workspace channels — one trigger clause and one audience arm.
- ✅ **Recommendation: (a) for now, and WRITE IT DOWN as a rule rather than leaving it as
  a `standard` early-return.** The negation hazard F-564 names is exactly this shape.

**R4 — Should the MCP container LOCK arm for a multi-member STANDARD workspace too?**
`factory.ts` (L186-191) arms only for `"home channel"` + `memberCount !== 1`. A session
pinned to a shared standard workspace therefore sees the operator's **entire** directory
(every container, every workspace) through `getWorkspaceList`.
- (a) Keep — a workspace is not a private relationship.
- (b) Arm for any container with 2+ members.
- ✅ **Recommendation: ask.** This is a real enumeration difference and the argument that
  bought the home lock ("a peer's room must not be a directory oracle") is not obviously
  weaker in a shared workspace.

**R5 — Should the audience-change PREVIEW (confirm token) fire in a standard workspace?**
It fires only inside a shared `link` container (`tools/confirm-token.ts` L181, L188).
Publishing a KB, skill or agent template **workspace-wide** gets no preview, no token and
no `acknowledgeShared` — argued explicitly at `tools/knowledge-ops-write.ts` (L76-81,
L247-248). **The workspace door is wider and quieter than the home door.**
- ✅ **Recommendation: ask.** The stated reason ("a workspace publish is expected") is
  plausible, but it is the single largest *behavioural* home-only gate on the MCP surface.

**R6 — `workspace=` is slated for removal next release, and it is the ONLY way to address
a container.** `packages/mcp-server/src/workspace-arg.ts` (L53-56) says so; containers get
**no slug** (`meta-tools.ts` L181-184; `instructions.ts` L114; `workspace-directory.ts` L301).
- ✅ **Recommendation: block the removal until a container has an address the other 9+ ops
  accept**, or give containers slugs.

**R7 — One name for `channel_members.favorited_at` on the wire.**
`HomeChannel.favoritedAt` vs `Channel.myFavoritedAt`. This already cost a user-visible bug
(§B.2). Renaming is a cross-package change (the SDK mirrors both types with a committed
`dist/` that §14 gates).
- ✅ **Recommendation: `myFavoritedAt`**, because the `my*` prefix states the
  caller-relativity that an account-wide payload will *stop* being able to assume.

**R8 — `channel_personal_arming` is dead. Drop it?** Nothing writes it
(`src/shared/tenancy/personal-reach.ts` L14-18); three live policies still count against
the RLS surface; it is still a CASCADE child of `channels` and so still in
`channels/schema-sql.test.ts`'s count.
- ✅ **Recommendation: drop it in the parity wave**, per the standing "delete, don't disarm" ruling.

### F-notes — doc/code disagreements found while auditing (CLAUDE.md requires these be named, not silently fixed)

1. 🔴 **`src/features/workspaces/server/authz.ts` (L34-53) still describes the retired
   TWO-MEMBER CAP** — *"A `kind='link'` home-channel container holds at most TWO members"*
   and *"The hard fence under both is the database — `enforce_link_container_member_cap`
   (migration 20260824120000)"*. That trigger and its function were **dropped** by
   `20260830120000_link_container_multi_member.sql` (L89-90), and INVARIANTS §4A records
   the retirement. **The code is right, the comment is stale.** File as a finding.
2. 🔴 **`packages/contracts/src/workspaces.ts` (L47-64) carries two stale claims**:
   `"link"` is described as *"holding ONE or TWO members"* (cap retired 2026-08-26), and
   `personal` as *"NO ROW HAS THIS KIND YET — the migration is unapplied and the dual-write
   sits behind `TENANCY_PERSONAL_CONTAINER` (default off)"*. INVARIANTS §4A says that is not
   a claim a repo can make, and `grep -rn TENANCY_PERSONAL_CONTAINER src packages apps`
   answers **comments and test prose only — no code reads it**
   (`supabase/migrations-held/README.md` L68 says the same). File as a finding.
3. ⚠ **A THIRD overview-series cache entry is live on /home — DELIBERATELY, and that is
   the point.** `src/features/channels/components/channel-surface-data.ts` (L51) imports
   `useOverviewSeries` from `features/workspaces`, documented at L45-50 as *"THE ONE
   CROSS-FEATURE READ ON THIS SURFACE, AND IT IS MOUNTED HERE ON PURPOSE (F-316)"* — the
   alternative was a channels-side copy of the fetcher. The consequence is still a parity
   fact: when that shared surface is mounted inside /home, the thread-activity strip hits
   `/api/workspaces/…/overview-series` while the page beside it hits
   `/api/home/overview-series` — **two ledgers, one screen.** Not a bug to fix in place;
   an argument for collapse 2 (§B.3).

---

## §G Target structure — the container-kind contract the UI host contract sits on

### G.1 The shape, in one sentence

> **One implementation per concern, parameterised by a `ContainerScope` the host
> supplies; the kind is data, never a branch in the feature.**

`src/shared/tenancy/personal-container.ts › resolveShelfScope` is the worked example
already in the tree: one function, one fence, `shelf` as a parameter, an EMPTY list as the
fail-safe, and a REFUSAL (`PersonalContainerMissingError`) instead of a fallback. Its own
header records that it **replaced two hand-mirrored copies** (`resolveHomeScope` and
`resolveTemplateHomeScope`) and collapsed two error classes into one. **That is the
template.**

### G.2 The four layers

```
                 ┌──────────────────────────────────────────────┐
  HOST           │ /home host          │ workspace host         │  ← UI host contract
                 │ scope = account     │ scope = container(seg) │     (the OTHER doc)
                 └──────────┬───────────┴───────────┬───────────┘
                            ▼                       ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ 1. SCOPE RESOLUTION  — one module, `src/shared/tenancy/`       │
  │    resolveScope({ caller, scope }) -> { workspaceIds[], kinds }│
  │    · account  = every container the caller is a member of      │
  │    · container = the one the host named (+ the caller's own    │
  │                  personal container, per resolveShelfScope)    │
  │    EMPTY LIST is the fail-safe. A write with no scope REFUSES. │
  └───────────────────────────────┬───────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ 2. CAPABILITIES  — ContainerCapabilities (§D.3), per container │
  │    kind · membership · offersTeamScope · isSoleAudience        │
  │    · wallet · address · noun                                   │
  │    Derived ONCE from the workspace row. Never by negation.     │
  └───────────────────────────────┬───────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ 3. FEATURE SERVICES  — kind-BLIND. One listChannels, one       │
  │    overview, one series, one grant reader. They take a scope   │
  │    and capabilities; they never ask `kind === …`.              │
  └───────────────────────────────┬───────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────┐
  │ 4. FENCES  — membership (RLS + `canSee*`), already kind-blind. │
  │    UNCHANGED by all of the above. Do not let a capability      │
  │    become a visibility gate.                                   │
  └───────────────────────────────────────────────────────────────┘
```

### G.3 The rules that make it hold

1. 🔒 **The kind is asked POSITIVELY, always.** `kind === "link"`, `kind === "standard"`,
   or a `switch` with a `default` arm — **never `!isStandardWorkspace(…)`**. F-564 is the
   standing finding; `src/features/workspaces/home-channel-derivation.test.ts` derives the
   set and holds each site's disposition, and `packages/mcp-server/src/workspace-directory.ts
   › containerKind` is the `switch` to copy.
   - ⚠ **The ONE exception is a FENCE**: `authz.ts › assertMemberAddable` reads the
     negation *on purpose*, so a fourth kind inherits the refusal rather than opting in.
     A fence negates; a label does not.
2. 🔒 **A capability is not authorization.** `isStandardWorkspace` is a LISTING predicate;
   `offersTeamScope` is an OFFER; `isSoleAudience` is an AUDIENCE SIZE. Authz stays
   membership, everywhere. Pinned precedent:
   `agent-templates/server/service-shelf.test.ts › does NOT become a visibility gate`.
3. 🔒 **One wire name per fact.** `favorited_at` has two (§A10) and it cost a bug.
   Before any field is added to a merged projection, it gets ONE name.
4. 🔒 **A scope resolver REFUSES rather than falling back.** `resolveShelfScope` returns an
   EMPTY list for an unreachable shelf and `personalWriteWorkspaceId` throws — because the
   fallback writes a row nothing can find. A `scope=account` read that cannot resolve the
   caller's containers must answer empty, never "the workspace you happen to be in".
5. 🔒 **Fan, never per-row.** `home/server/service-reads.ts › hydrateChannels` is the
   pattern: two `Promise.all` tiers over de-duplicated id sets, never a query per row. The
   merged list read inherits this, plus a `truncated` flag (§B, collapse 3).
6. 🔒 **Publication and subscriber ship together** (INVARIANTS §7). If the merged channel
   list gains a doorbell, `SYNC_TABLES` and the publication move in the same release, and
   `test/ui-sync-tables.test.mjs` pins both directions.
   - ⚠ **/home structurally cannot satisfy today's doorbell**: `main/ui-sync.js › watch`
     holds **exactly ONE** realtime channel filtered on ONE `workspace_id` (F-222,
     *"ONE WATCHED WORKSPACE FOR ALL WINDOWS … last-writer-wins"*), and the renderer elects
     one by majority (`shared/realtime/shared-channel-registry.ts › wantedWorkspace`).
     An account-scoped surface spans N containers and can be live for at most one.
     **This is a substrate decision the host contract cannot paper over.**
7. 🔒 **The gates move with the code.** `check-rls-pair-gate`, `check-role-drift`,
   `check-knowledge-type-drift`, `check-message-kind-drift`, the committed-`dist` check and
   the `rls-redteam` job (seven named files, not a glob) all constrain this area. A merged
   DTO touches `@dopl/contracts` and both committed `dist/` trees.

### G.4 What is ALREADY at the target, and should be copied rather than re-invented

| Already right | Why it is the model |
|---|---|
| `src/shared/tenancy/personal-container.ts › resolveShelfScope` | one function, `shelf` as a parameter, empty-as-fail-safe, refusal-not-fallback |
| `supabase/migrations/20260914120000_resource_grants.sql` | one polymorphic grant table, **zero** `kind` clauses, cross-container reach bought with an author |
| `GET /api/knowledge/bases?shelf=` and `GET /api/agent-templates?shelf=` | one route, one auth wrapper, the shelf as a `WHERE` |
| `billing/server/credits-service.ts › containerTarget` | the whole kind→wallet table in one function, reached from both arms so neither can drift |
| `agent-templates/lib/visibility.ts › offersTeamScope` + `components/template-editor.tsx › containerKind` prop | an in-kind difference expressed as a HOST-SUPPLIED PROP over ONE component |
| `packages/mcp-server/src/workspace-directory.ts › containerKind` | a `switch` with a `default`, read in exactly one place, five consumers |
| `features/channels/types-account.ts › AccountChannelStatus` | one DTO that already spans all three kinds |
| `dopl-desktop-app/main/**` | **already at parity by construction** — no "home" concept at all; every store key is channel-id-keyed and container-blind |

---

## Appendix B1 — full duplicate client-cache inventory (measured 2026-09-17)

Key tuple is `[path, workspaceId, query]` (`src/shared/api/query-keys.ts` L24-28); prefix
key is `[path]` (L47).

| # | Data | HOME key + site | WORKSPACE key + site | Bridged? |
|---|---|---|---|---|
| 1 | Channel rows (name, topic, pin, unread) | `["/api/home/channels", undefined, undefined]` — `pages/home/home-rows.ts` L10; mounted `pages/home/index.tsx` L93; also `ontology-share.tsx` L205, `overview-usage-filter.tsx` L74, `app-shell.tsx` L128 | `["/api/channels", <workspaceId>, undefined \| {include:"archived"}]` — `features/channels/client/query-keys.ts` L22/L84; read `hooks/use-channels.ts` L14 | **Yes, one-way** — `pages/home/use-home-channel-sync.ts` L58-111 copies only `myFavoritedAt→favoritedAt`, `name`, `topic` (L78, L88, L93) |
| 2 | Unread marks | same `/api/home/channels` entry | `Channel.unread` on `/api/channels` | **Yes, one-way** — `use-home-unread-refresh.ts` L37-50 invalidates on the TRANSCRIPT cache entry (L48) |
| 3 | Overview | `["/api/home/overview?range=month", …]` — `overview-panels.tsx` L91 | `["/api/workspaces/{segment}/overview", <workspaceId>, …]` — `pages/overview/index.tsx` L61/L83 | **No bridge** |
| 4 | Overview series | `overview-usage-filter.tsx` L254, consumed `overview-panels.tsx` L256 | `pages/overview/index.tsx` L63/L89 **and** `features/workspaces/hooks/use-overview-series.ts` L54 | **No bridge.** ⚠ third entry — see F-note 3 |
| 5 | Channel creation | `POST /api/home/channels` — `home-writes.ts` L52; invalidates **only** `/api/home/channels` (L53) | `POST /api/channels` — `src/app/api/channels/route.ts` L44 | **No bridge** — a home-created container never invalidates `/api/channels` |
| 6 | Links / invites | `["/api/home/links", …]` — `home-rows.ts` L11; writes `home-writes.ts` L62/L72 | no analogue (`/api/join`, members routes) | home-only |
| 7 | Token spend | `["/api/home/token-spend", …]` — `overview-token-spend.tsx` L46 | none | home-only |
| 8 | Boot | `bootQueryKey(null)` — `pages/home/index.tsx` L95 | `bootQueryKey(segment)` — `use-workspace-route.ts` L98 | intentional (`use-boot-state.ts` L56) |
| 9 | Workspace rail list | same key — `pages/home/index.tsx` L92 | same key — `app-shell.tsx` L152 | same entry, **two byte-identical selector copies** (`index.tsx` L351, `app-shell.tsx` L319) |

🔴 **Fields crossing cache #1 that are NOT bridged: `peers`, `lastMessageAt`, `linkOut`,
`archivedAt`, deletion.** A channel archived, renamed-away or gaining a member from the
workspace page leaves the /home row **stale until a cold refetch**.

---

## Confidence and gaps

**High confidence** (read directly, in this worktree, at `03506fcd`):
- The container-kind branch inventory in the web tree, the MCP package and the desktop main
  process. All three were swept by grep **and** read; the MCP result (`kind` read in exactly
  one function, five consumers, two behavioural) is a strong, checkable claim.
- The three channel-list projections, the two overview families, and the nine duplicate
  cache entries. Every one was opened.
- The `home_scoped` state (nothing reads it), the single held migration and its live
  precondition, the single remaining kind-specific trigger, and the seven kind-blind
  `canSee*` predicates.
- The credits wallet table and rule B.

**Medium confidence:**
- **The permission adapter in §D.3 is a PROPOSAL, not a measurement.** The six fields are
  derived from the questions the code asks today; a seventh may surface when someone tries
  to write it.
- The collapse plans in §B are sketches with named hazards, not implementation plans. In
  particular the §8 stale-cache migration for `/api/home/channels` (24h `gcTime`,
  IndexedDB-persisted, five documented per-field fallbacks) is the hard part and is not
  costed here.

**Gaps — what this audit did NOT establish:**
1. 🔴 **Deploy state.** No database was contacted (instructed, and correct per INVARIANTS
   §12). Whether `20260920120000_workspace_kind_personal`, `20261001120000/130000`
   (ontology home shares) and `20260930120000_credit_wallets` are APPLIED is **unmeasured**.
   `supabase migration list`, joined on the NAME, is the only answer. Several conclusions
   about `personal` are therefore about the CODE's assumption, not about live rows.
2. **The web tree's negation sites.** INVARIANTS §4A says half the `!isStandardWorkspace`
   sites are *"a ternary's else-branch or an early return"* and that
   `home-channel-derivation.test.ts` is the derivation. I did not run that suite (read-only,
   no builds), so the exact OPEN_SITES/FENCE_SITES membership is taken from the docs.
3. **The workspace-side Overview's UI.** The UI audit is another document; I mapped the
   payloads, not the panels.
4. **Skills and chats.** `/home` has no Skills or Chats face and I did not chase whether
   their services would need scope work — they are `resource_grants` clients, so probably
   not, but that is an inference.
5. **Performance.** A `scope=account` channel list fans over N containers. `hydrateChannels`
   is a bounded two-tier fan today over ≤200 containers; the merged read's cost at the
   workspace end (`listChannels` is a known `select("*")` non-conformer, INVARIANTS §9) is
   not modelled here.
6. **Nothing here was built or committed.** Read-only, as instructed.
