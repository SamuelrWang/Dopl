# Drift ledger — everything outside `/home`, judged against the `/home` standard

**Measured 2026-08-30** against `master` @ `6b3b1ead` (v1.22.0). Synthesis of seven read-only
audits (core pages · knowledge+agents+guest lane · legacy surfaces · cross-cutting · stale-cache ·
role floors · duplicated rules). **No product file was edited by any of them, or by this file.**

Other sessions hold uncommitted work in the tree (`docs/INVARIANTS.md`,
`dopl-desktop-app/main/auth.js` and siblings, `src/features/marketing/marketing.css`,
`src/features/marketing/components/hero-banner.tsx`, `banner-demo/`). **Every claim below is made
against HEAD, and those paths are excluded from every verdict.**

Conventions, per `docs/INVARIANTS.md`:
- **A number carries its measurement date.** Everything here is 2026-08-30 unless stated.
- **Code references are symbol anchors** (`path › symbol`). No bare line numbers.
- **Re-run the command, never quote the answer.** Counts here are a snapshot, not a contract.

Verdicts: **PORT** (bring to the standard) · **LEAVE** (deliberate, or not worth the churn) ·
**ASK** (a product question, not an engineering one).

---

## 1. Executive summary

- **Health: better than a "legacy audit" framing predicts, and worse in exactly two places.** The
  type scale is clean (zero `text-sm`/`text-xs`/`text-[NNpx]` in every audited app surface — the
  135 hits repo-wide are all in DESIGN-SYSTEM-exempt or out-of-territory files). Hardcoded hex in
  non-exempt components is **one value**. Role floors **hold**: the 2026-08-26 hardening has no
  survivors, and the code-derived guest set is byte-identical to the pinned 19-in-15-files contract.
  Realtime has no orphaned publication and no orphaned subscription.
- **The two bad places are loading states and dialogs**, and both have the same cause.
- **The thesis, and it is one sentence: the `/home` wave built the right primitive and gave it one
  call site.** `SkeletonSurface` (desktop tree only), the `StandardDialog` contract (4 adopters,
  ~17 hand-rolled dialogs left), the no-concave sweep's hand-typed `HOME_FILES` list, the
  `CACHE-SHAPE FALLBACK` notation (2 uses, both `/home`), `OpenScaleButton` (37 hand-rolled
  `btn-light h-*` sites across five heights), and the web-vs-desktop `channels-skeleton.tsx` pair
  are **six instances of one thing**. None is a missing decision. All six are a missing second call
  site — and in three of them the two call sites are **same-named files in different trees**, which
  is what makes the gap invisible to a reader who greps a basename.
- **Corollary, and it is the planning advice: the cheap wins are not the PORTs, they are the
  GATES.** 6 of 7 duplicated-rule PORTs need **zero new tooling** — an existing gate or harness
  simply was not extended when the 1.22.0 wave added a mirror beside it.
- **Headline counts (2026-08-30):** 14 live defects · 9 gates to extend · 21 port groups ·
  33 ruled-LEAVE items recorded so the next wave does not re-litigate them · **36 open ASKs** ·
  F-ledger: 227 live entries, **169 open**, 19 to close, 24 grew worse, 4 corrections owed,
  35 F-ids cited from source with no live entry.
- **Where auditors disagreed, §9 says so.** Three real disagreements: the overview `?? EMPTY_X`
  severity, whether `playground/**` is a mock tree, and whether F-345's count is a ledger defect.

---

## 2. LIVE DEFECTS — broken now, ranked by user impact

Each row: **file › symbol** · the failure scenario · the fix direction in one line.

### D1 🔴 A refused `/api/billing/status` paints fabricated numbers
`src/features/billing/components/use-workspace-entitlements.ts › useWorkspaceEntitlements` does
`query.data ?? DEFAULT_STATUS`, and the fallback fires **on error as well as on cold**.
`› DEFAULT_STATUS` is not empty — it is an assertion (`plan:"free"`, `memberCount: 1`,
`credits.limit = MONTHLY_MCP_CREDITS.free`). There is no `isError` in the returned shape at all,
unlike its sibling `src/features/billing/components/use-billing-account.ts`, whose docblock says
*"THREE OUTCOMES, NOT TWO."* A guest or a 500 therefore renders a measured-looking *"MCP credits
0 / 200 · Starter plan · 1 member"* in `› billing-usage-pane.tsx` and
`src/shared/layout/settings-modal/sections/plans-billing-core.tsx › BillingSummary`.
→ **Fix:** return `isError` (the sibling hook is the pattern) **and consume the `degraded` flag the
server already sends** — `src/features/billing/server/credits-service.ts › CreditsSummary` carries
it and the client discards it (`grep -rn "degraded" src/features/billing/components` → 0 UI reads).

### D2 🔴 §8 stale-cache: 5 overview reads and 10 entitlement keys throw on a key-absent cached entry
The desktop query cache is IndexedDB-persisted with a 24h `gcTime` and **no key allowlist** — every
successful query on every page survives an upgrade. `apps/desktop-ui/src/pages/overview/index.tsx ›
OverviewSurface` gates on the *container* and then reads through:
`overview.data.memberLoad.totalMessages` (`› member-load.tsx › MemberLoad`), `series.data.days`
(`› activity-chart.tsx › ActivityChart`), `overview.data.activity`
(`› recent-activity.tsx › RecentActivity`), `overview.data.counts[key]`
(`› overview-bits.tsx › padCount`), and `credits.limit.toLocaleString()`
(`› period-stats.tsx › PeriodStats`). §8 is explicit that a container guard is **not** a fallback on
the key. The same hook (D1) re-spells only 2 of 12 keys; `billing-usage-pane.tsx`'s
`ent.objectsUsed.toLocaleString()` throws, and `› billing-plans-pane.tsx`'s
`ent.has_stripe_customer` is falsy-when-absent, so it **silently hides Payment method, Invoices and
Cancel plan from a paying admin**.
→ **Fix:** inline `?? EMPTY_X` per key (§8 forbids hiding it behind an accessor) + a fixture with
the key **deleted**, seeded into the component or QueryClient directly. One hook fixes both
surfaces. ⚠ **Auditors disagree on the overview half — see §9.1.**

### D3 🔴 `useToggleBaseStar` throws on a stale cache entry
`src/features/knowledge/client/hooks.ts › useToggleBaseStar` has three unguarded
`prev.starredBaseIds` reads in the optimistic updater; `.includes()` throws on an entry written
before 2026-08-12, when the field was added — i.e. **post-persister**. `fetchBaseList`'s wire
fallback cannot reach the cache path (§8's own route-fixture rule). The same defect sits in the
reference implementation: `apps/desktop-ui/src/pages/home/knowledge-panel-cards.tsx › useStarToggle`
guards the read and repeats the unguarded read in its optimistic **write**.
→ **Fix:** `const stars = prev.starredBaseIds ?? EMPTY_STARRED;` inline, both sites, plus a
key-DELETED fixture in `src/features/knowledge/client/hooks-stars.test.tsx` — which today always
constructs the key, and that is the gap that let this ship.

### D4 🔴 A workspace VIEWER sees live Delete + Settings on every knowledge base
`src/features/knowledge/components/knowledge-v2/knowledge-v2.tsx › KnowledgeV2` passes
`c.canEdit(openBase.id)` to `ListPanel` and `DetailPanel` and passes **nothing** to
`src/features/knowledge/components/knowledge-v2/detail/base-header.tsx › BaseHeader`, which takes no
`canEdit` prop. The server refuses, so this is a pressable destructive control plus a 403 — the
F-330 severity class reached through *no gate at all* rather than a gate that falls open.
The counter-example is in the same feature:
`src/features/knowledge/components/kb-channel-grants-section.tsx` renders a read-only sentence when
the **server-supplied** `canManage` is false.
→ **Fix:** thread `canEdit` into `BaseHeader`; default closed. (§10 ASK-14 covers whether the header
should carry destructive controls at all.)

### D5 🔴 The landing nav's closing menu card swallows the next click for 140ms
`src/features/marketing/marketing.css › .lp-nav-menu-card` has no `pointer-events: none` on
`[data-state="closing"]`; the `src/app/globals.css › .menu-card` twin has the rule **and its
reasoning**. This is the duplicated-rule class arriving as a live bug — DESIGN-SYSTEM's "edit both
together" prose instruction demonstrably failed. `globals.css` wins.
→ **Fix:** add the rule; consider `inert` on the site-nav card. ⚠ `marketing.css` is another
session's dirty file — coordinate before editing.

### D6 🔴 `dopl://open?target=/link/tok` parses as a workspace slug
`dopl-desktop-app/main/deep-link-target.js › WEB_ONLY_ROOTS` is missing **five** roots that
`src/config/index.ts › RESERVED_WORKSPACE_SLUGS` and `src/shared/auth/public-routes.ts ›
PUBLIC_ROUTES` both carry: `link`, `c`, `authenticate`, `signup`, `get-started`. So a claim link
resolves to workspace `/link/overview`. **F-317 is open and understates it** — it knows only `link`.
→ **Fix:** add the five; `RESERVED_WORKSPACE_SLUGS` is the reference. Gate in §3 (G6).

### D7 🔴 Two undialogged modals mounted on every workspace page
`src/features/onboarding/components/connect-agent-banner.tsx › ConnectAgentBanner` and
`› welcome-popup.tsx › WelcomePopup` live in `features/onboarding/` but are mounted by
`apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout`, inside
`MyAccessProvider`. Neither composes `ModalShell`. **Neither has `role="dialog"`, `aria-modal`, an
Escape handler, a body-scroll lock, or focus return** — all of which `src/shared/ui/modal-shell.tsx ›
ModalShell` provides. Both also carry an inline raw font stack and re-typed token hexes
(`#fbfcfd`, `#98a2ad`, `#232a31`, `#646d78`) plus `text-[24px]`/`text-[14.5px]`/`text-[13px]`.
⚠ **The framing is the finding:** read as "onboarding" these are exempt; read as "what the app shell
mounts" they are the two worst surfaces in the audit. Either answer implies **moving them out of
`features/onboarding/`**.
→ **Fix:** compose `ModalShell`; the token half follows for free.

### D8 ✅ CLOSED 2026-08-30 — A failed roster read told the operator the workspace was empty
**AS AUDITED:** the v1 members tab rendered `members.length === 0 ? "No members yet." : …` while its
host dropped `error` on the floor (`const memberList = members ?? []`), so a 404 or 500 on the
roster read as *"No members yet."* The v2 counterpart already carried the fix **and the argument**
(`src/features/members/components/members-v2/members-v2-view.tsx`: *"⚠ A FAILED roster read must not
fall through to the panes…"*).
→ **RESOLVED BY DELETION, not by a port** (Samuel's ASK-1 ruling, option a): the whole v1 console and
the settings pane that mounted it are gone, so the guard has one implementation and it is v2's —
**verified in place at closure time**. The citations that named the v1 files are removed with them;
what they described is recorded above.

### D9 🔴 Every confirmation dialog in the app wears a drifted white face
`src/shared/layout/settings-modal/settings-modal.module.css › .btnCancel` /`› .btnConfirm` /
`› .btnDanger` / `› .confirmActions` is a module-scoped dialog footer whose own comment admits it:
*"⚠ Kit button recipes copied by value, keep in sync with globals.css."* **The contract is already
broken** — `.btnCancel`'s hairline is `#d6d8db` against the kit's `#d4d4d4`, and its shadow is two
layers against the kit's three-layer bevel. The consumer list is 7 non-test files and one of them is
`src/shared/ui/confirm-dialog.tsx › ConfirmDialog`, the sanctioned primitive.
→ **Fix:** rewrite those four rules onto `--raised-light-face` / `--raised-light-line` /
`--raised-light-shadow` + the kit black CTA. **One file; corrects the whole app; touches no
component.** Do this first — it is what makes §4's dialog migrations cheap rather than nine
independent rewrites.

### D10 🟠 `.lightScope` silently reverts the 2026-08-19 secondary-ink darkening
`src/shared/layout/app-shell/app-shell.module.css › .lightScope` re-declares the whole `:root`
palette locally and its comment asserts *"No-op: re-declares the exact values it already inherits."*
**That is no longer true.** Diffed all ten headline values against `src/app/globals.css`: exactly one
drifted — `--text-secondary` is `#57606b` in both `globals.css` and
`apps/desktop-ui/src/styles/tokens.css` (*"darkened from `#646d78` (Samuel, 2026-08-19)"*) and still
`#646d78` here. Tailwind utilities are unaffected (they resolve off `:root`); what is affected is
anything **re-deriving from the raw token inside a `.lightScope` subtree** —
`src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css`'s `--kv-text-2` and
`--kv-scope` are exactly that shape, under a scope that wraps `base-tree.tsx` and `base-header.tsx`.
**Same miss, second site:** `src/features/billing/components/checkout-appearance.ts` maps
`#646d78 → --text-secondary`, so Stripe's embedded checkout renders the pre-2026-08-19 grey.
→ **Fix:** delete the block (its own comment sanctions deletion) or correct the one value; fix the
Stripe table in the same change.

### D11 🟠 The channels page paints two different skeletons in sequence
`apps/desktop-ui/src/pages/channels/index.tsx › ChannelsPage` gates on `useWorkspaceAccess` →
`apps/desktop-ui/src/pages/channels/channels-skeleton.tsx › ChannelsSkeleton`, the page's own
three-column shape. The workspace resolves,
`src/features/channels/components/channels-v2/channels-v2-core.tsx › ChannelsV2Core` mounts and has
its **own** gate onto a *different* `src/features/channels/components/channels-skeleton.tsx` — a
372px avatar list over a 760px document column. **Load sequence: three columns → two panes → the
real surface.** Both files concede the shape is wrong in their own docblocks.
→ **Fix:** a `loadingSkeleton` slot on `ChannelsV2Core`, exactly as
`src/features/agent-templates/components/agent-templates-core.tsx ›
AgentTemplatesCoreProps.loadingSkeleton` does it, with a host passing nothing keeping today's
behaviour. **F-220 covers only half of this** (the two-pane shape) — extend it, do not re-file.
⚠ Secondary: the shared ghost uses `DetailPaneSkeleton`, one of the three composites lacking
`role="status"` (F-318), so the second ghost announces nothing.

### D12 🟠 The guest lane shows fixture data and dead buttons to an external person
`src/app/c/[workspaceId]/guest-channel.tsx` mounts the **default**
`src/features/channels/components/channels-v2/info-tab.tsx › InfoTab` (it passes no `slots.infoTab`),
which carries `HARDCODED_LINKED_THREADS` and a 31-entry `HARDCODED_THREAD_ACTIVITY` from
`src/features/channels/components/channels-v2/fixtures.ts`, plus two `IconButton`s with **no
`onClick`** ("Add member", "Filter members"). `› channel-surface.tsx ›
ChannelSurfaceCapabilities.memberManagement` reaches only the settings slot, never the info column —
its docblock's claim that `false` *"hides the invite affordance and its dialog"* is false of this
host, and it defaults **open** (`?? true`). **F-316 and INVARIANTS §5 both mis-scope this to "the
channels page"; `info-tab.tsx` has had two hosts since 2026-08-25.**
→ **Fix:** product decision first (§10 ASK-15/16) — but the doc mis-scope is a straight PORT.

### D13 🟠 `GET /api/workspaces/me` is a third unlocked door on `resolveActiveWorkspace`
`src/app/api/workspaces/me/route.ts` never threads `apiKeyWorkspaceId`, so a container-locked
credential sending no header auto-targets the **operator's home workspace** id/slug/publicId — the
exact walk INVARIANTS §4 closed on boot's provisioning branch. Role axis is fine (own record only).
Severity **LOW in effect** (`GET /api/workspaces` hands the list by contract) but **MEDIUM in shape**.
→ **Fix:** ~6 lines — thread the lock, 403 a contradicting target, refuse header-less auto-target for
locked callers; grow `src/features/workspaces/server/api-workspace-floor.test.ts`'s caller-scan to
cover `resolveActiveWorkspace` callers.

### D14 🟡 `scripts/smoke-billing.mts` prints a cap it does not assert
Its label says `objectCap=1000`; `src/features/billing/server/entitlements.ts ›
FREE_MULTI_MEMBER_OBJECT_CAP` is **100**. The assertion itself is correct (it compares against the
constant) — only the human-readable label lies.
→ **Fix:** interpolate the constant into the label.

**Latent, armed the day anyone adds a field** (recorded here so it is not re-derived):
`apps/desktop-ui/src/pages/chats/index.tsx › ChatsPage` guards `folders` and not `chats`, and
`src/features/chats/components/chats-view.tsx › ChatsView` opens with `initialChats[0]?.id` — a
`TypeError` and a blank pane. Verified dormant: `git log` on `src/features/chats/types.ts`,
`src/features/skills/types.ts` and `src/features/ontology/types.ts` shows **no field additions**
since the persister shipped. Two `?? EMPTY_CHATS` + a key-deleted fixture closes it.

---

## 3. GATES TO EXTEND — the cheap wins

**6 of 7 need zero new tooling.** Each is an existing gate or harness that was not extended when a
mirror was added beside it. Do this section **first**: it is what stops §4 from being re-audited in
six weeks.

| # | Gate | What it must assert | Where the mechanism already is |
|---|---|---|---|
| **G1** | `KbShelf` / `TemplateShelf` union — **highest value** | 4 `src` sites + `dist` + MCP vocab + SQL booleans, **no gate**. Drift silently WIDENS an access-shaped filter: a misspelled shelf answers the wider list. | Add a union pass to `scripts/check-knowledge-type-drift.ts`; `scripts/check-role-drift.ts › extractUnion` is the helper. |
| **G2** | `TOOL_MODES` / `MESSAGE_MODES` | 5 declarations (3 desktop main, 2 web), no cross-tree gate. A web-side mode the desktop rejects **fails closed silently** to `manual`/`ask` — the supervision setting reads as saved and is not. | ~6 lines in `src/features/channels/components/channels-v2/settings-agent-posture.test.tsx` via the already-imported `desktopSource` harness. `dopl-desktop-app/main/session-profiles.js › TOOL_MODES` wins. |
| **G3** | Agent-template caps (32768/8192/120/2000/50/1000/80) | Across SQL + `src` + MCP (a **bare literal**) + desktop, no gate. `src/features/agent-templates/schema.test.ts` **claims** the SQL pairing in prose and never reads the migration — a comment claiming a pairing is not a gate. | A new schema-sql test under `src/features/agent-templates/`, on the pattern `src/features/channels/schema-sql.test.ts` and `src/features/knowledge/schema-sql.test.ts` already set; give the MCP copy a named constant. Migration wins. |
| **G4** | Plan feature strings | `src/features/billing/plans.ts` and `src/features/marketing/components/pricing-content.tsx › COMPARE_ROWS` restate `src/features/billing/credits.ts › MONTHLY_MCP_CREDITS` and the caps **3×**. Drift = **public pricing misrepresentation**, invisible to tests. | Interpolate the constants — that deletes the duplicate rather than gating it. `entitlementDeniedBody` already does this. |
| **G5** | F-295 `isStandardWorkspace` / `WorkspaceKind` | Verified still open: `grep -rn "isStandardWorkspace\|WorkspaceKind" scripts/` → **0**. Bodies are byte-identical today only because both were flipped together on 2026-08-24. Consumers of the package copy went 3 → **6** during the wave, and one of them is now a **confirm gate**. | ~15 lines in `scripts/check-role-drift.ts`, which already opens both files. |
| **G6** | `WEB_ONLY_ROOTS` subset assertion (closes **D6**) | `WEB_ONLY_ROOTS ⊇ (RESERVED_WORKSPACE_SLUGS ∩ top-level routes)`. | `dopl-desktop-app/test/deep-link-target.test.mjs` already reads across trees. |
| **G7** | `globals.css` ↔ `tokens.css` token diff | 219 shared tokens, 216 identical, 3 documented deviations. Was a LEAVE — **raise to PORT**, because D5 and D10 are two live proofs that a prose "edit both together" instruction fails. | ~20-line `--*` diff script with an allowlist. New tooling, but 20 lines. |
| **G8** | Sweep-list hardening | `src/features/agent-templates/components/template-editor.test.tsx › HOME_FILES` is a **hand-typed list of five**. It missed `apps/desktop-ui/src/pages/home/link-out-panel.tsx`, which renders a surface — the stated membership test. **The enforcement mechanism, not the ruling, is what drifted.** | Either derive `HOME_FILES` from a directory scan of `apps/desktop-ui/src/pages/home/*.tsx` with an explicit opt-out list, **or** state the scope limit in the test header so the next reader knows what is not covered. Same shape as `POST /api/boot`, whose floor lives in `src/features/workspaces/server/segment.ts › BOOT_MIN_ROLE` and is structurally invisible to the guest-route sweep (route-file parsing only). |
| **G9** | Findings-citation gate | `scripts/check-doc-refs.mjs`'s class (d) catches a **dangling** id, never a **mis-cited** one — and **35 F-ids are cited from source with no live entry** (F-228 in 73 source files, F-212 in 32, F-236 in 16, F-139 in 16, F-142 in 15, F-147 in 15, F-320 in 14, F-233 in 13). `F-031` resolves to nothing at all and 4 source files cite it. **Two heading forms** (105 `###` / 122 `##`) mean every single-form grep under-counts by ~half. The legend says resolved entries are deleted; **58 are kept in place**. | No new tooling for the doc half: fix the legend, unify the heading form, restore the `Status:` line to the 32 prose-format entries. The source-side F-id sweep is 1,210 references currently ungated by anything but existence. |

**A ninth-and-a-half, recorded because it is the same class:** `src/shared/lib/url/safe-redirect.ts ›
POST_AUTH_LANDING_FALLBACK` is duplicated from `WEB_POST_AUTH_LANDING` with a `"⚠ Must equal"`
comment and **no test pins the equality**. One-line pin.

---

## 4. PORTS — worth doing, ranked by ROI

Deduplicated across all seven reports; each item cited once, at the strongest anchor.

### 4.1 Shared-layer ports (one or two files, corrects the whole app)

| # | Item | Why it is first |
|---|---|---|
| **P1** | **D9's dialog-footer rebuild** — `settings-modal.module.css › .btnCancel`/`.btnConfirm`/`.btnDanger`/`.confirmActions` onto `--raised-light-*` | 7 consumers including `ConfirmDialog`. Makes every §4.2 migration a face-swap instead of a rewrite. |
| **P2** | **D10's `.lightScope`** + `app-shell.module.css › .brandPill` onto `--raised-light-*` (byte-identical today → pure no-op refactor) + `› .upgradeBtn` and `settings-modal.module.css › .btnConfirm` onto the kit black CTA (`.auth-btn-3d` already owns `#313131 → #1c1c1c 52% → #111`) | Closes the drift the vars were introduced for. DESIGN-SYSTEM already **claims** `.brandPill` is tokenized; it is not. |
| **P3** | **Off-scale type in CSS modules** — the lint cannot see these: `app-shell.module.css › .wcTitle` (16px), `› .wcDesc` (**13.5px, not on the ramp at all**), `› .upgradeBtn` (15px); `settings-modal.module.css › .narrowTitle` (25px + `#1e242b` = `--text-primary` hardcoded), `› .narrowPath` (11px + `#98a2ad` = `--text-muted` hardcoded) | Hexes are unambiguous; sizes are one step each. |
| **P4** | **Dead CSS + dead tokens, both trees.** `.graph-node` / `-selected` / `-target` / `.graph-port` (+3 variants) / `.graph-node-lift`: **0 consumers** in `src/app/globals.css` and `apps/desktop-ui/src/styles/kit.css`. Four canvas-era tokens defined twice, read zero times: `--shine-top-gradient`, `--cluster-outline-stroke-strong`, `--cluster-outline-fill`, `--cluster-outline-fill-strong`. Plus `app-shell.module.css`'s `.main`, `.scroll`, `.serif` (0 consumers across both trees). | ⚠ **Split the graph group carefully — half is alive.** `.graph-substrate` and `.kanban-substrate` have 6 and 7 real consumers. Both files say *"delete the whole group or none of it"*; that was written when they shared a caller. **They no longer do**, and following it literally deletes the live ontology board's dot grid. Update DESIGN-SYSTEM and both CSS headers to stop claiming a shared fate. |
| **P5** | **Promote a flat-chip recipe beside `src/shared/ui/wells.ts › CHIP`** — the flat variant is declared 4× with no kit home (only `src/shared/ui/scope-share-popover.tsx` ships; the other three are playground panes). Pre-emptive, ~5 lines. | Cheap; stops a fifth copy. |

### 4.2 Dialogs — `StandardDialog` and the accessibility floor

4 adopters today. **~17 hand-rolled dialogs remain.** Sequenced by user visibility:

1. **`src/features/channels/components/create-channel-dialog.tsx › CreateChannelDialog` (425 lines) —
   highest.** The **same dialog exists twice, one ported and one not**: creating a channel from
   `/home` (`apps/desktop-ui/src/pages/home/new-channel-dialog.tsx`, `StandardDialog` + `RAISED_INPUT`)
   and from the channels page are two **visibly different** dialogs. This one uses `.concave-field`
   inputs — the pressed-in pill `src/shared/ui/standard-dialog.tsx`'s ⚠ explicitly forbids — a
   centered-but-not-uppercase `<h2>` instead of `› DIALOG_TITLE`, `rounded-[9px]` footer buttons
   instead of `› DIALOG_BTN_PRIMARY`'s `rounded-full`, and **6 hand-written button recipes**. Phase 2
   puts the primary black CTA face on the *dismiss* action. **PORT with a split** — the member picker
   is its own component, and the file is already at 425 against a 500 cap.
2. **`src/features/workspaces/components/create-workspace-dialog-core.tsx` (143 lines) — the flagship.**
   `/home`'s reference dialog names this as the thing it deliberately diverged from
   (*"⚠ NO EXPLAINER PARAGRAPH, unlike the create-workspace dialog it is modelled on"*). Same act,
   diverges on **every** axis including a two-sentence explainer whose second half narrates the
   account rail. Its writes bypass the mutation layer, and `app-shell.tsx` compensates with a manual
   `refetch()`.
3. **`src/features/members/components/invite-dialog.tsx` — two real bugs, not styling nits.**
   (a) The **role picker is a hand-rolled menu surface** — not `SelectMenu`, not `Popover`: an
   arbitrary raw `rgba` shadow, rows as bare `<button>`s, **no backdrop, no Escape, no viewport
   clamp**. DESIGN-SYSTEM: *"Never hand-roll the backdrop/Escape/clamp pattern."* This is the single
   control that decides an invitee's role and it is the least robust menu in the app; `SelectMenu`
   fits exactly, and the option second-lines already exist in
   `src/features/members/components/members-v2/member-facts.tsx › ROLE_COPY`.
   (b) **`SearchField` is being used as the email-entry control** — a `concave-field` search well
   wearing a magnifying glass, placeholder *"Search names or emails"*, whose value is fed straight to
   `parseEmails()` and POSTed as invitee addresses. A search that does not exist.
4. **`src/features/skills/components/skill-history-panel.tsx › DiffModal`** — the only fully
   hand-rolled dialog in the legacy territory: own `fixed inset-0`, own backdrop, own
   `window.addEventListener("keydown")`, `.bento` (the *inner card* recipe) as the dialog face. No
   focus trap, no `role="dialog"`, no `inert` background, no restore-focus. ⚠ Needs **ASK-19** first
   (its `max-w-4xl` is wider than `StandardDialog` can express).
5. **`src/features/agent-templates/components/launch-sheet.tsx › TemplateLaunchSheet`** — already
   imports `Field` (= `DialogField`) and `RAISED_INPUT`, so the conversion is mechanical: left-aligned
   `<h2>` → `DIALOG_TITLE`, `auth-btn-3d h-10 rounded-[9px]` pair → `DIALOG_BTN_*`. Its `SelectMenu`
   is the **flat** variant inside a dialog while the editor two files over passes `variant="raised"` —
   the exact pairing the contract forbids. Ships together. ⚠ Auditors split on whether a *sheet* is in
   the contract's scope — see §9.3.
6. **`src/features/skills/components/create-skill-dialog.tsx`** — the last unmigrated create dialog,
   and it *teaches*: it forks `RAISED_INPUT` and `DialogField` as module-local `FIELD`/`LABEL`
   constants, hand-writes `style={{textAlign:"center"}}` where `DIALOG_TITLE` supplies it, and carries
   the territory's clearest minimal-copy violation. Its docblock claims *"same ModalShell chrome as
   `CreateBaseDialog`"* — **false since that file migrated**.
7. **`src/features/members/components/create-team-dialog.tsx`**, **`src/features/channels/components/direct-message-dialog.tsx`**,
   **`src/features/channels/components/invite-dialog.tsx`** — same shape, sequence behind the above.
8. **`src/features/knowledge/components/base-settings-form.tsx` (395 lines) — the densest single drift
   site in the knowledge territory**, and worth doing **whichever dialog family it lands in**
   (ASK-13), because both families forbid a hand-rolled field face:
   - **4 copies** of the exact `bg-surface-raised-3 border border-border-strong` recipe
     `src/shared/ui/wells.ts`'s `RAISED_INPUT` docblock names as the anti-pattern by verbatim
     description. (The pre-`RAISED_INPUT` recipe survives in 4 files repo-wide; this is 4 of them.)
   - `› Section` **is** `src/shared/ui/section-panel.tsx › SectionPanel`, exactly. `› Field` **is**
     `standard-dialog.tsx › DialogField`, exactly. 6 and 3 call sites.
   - Two hand-rolled action buttons, one hardcoding `text-white` where the ramp has an ink token.
   - ⚠ `› Field`'s label uses `text-text-tertiary`; the token exists in `globals.css` but is **not in
     DESIGN-SYSTEM's colour table** and no `/home` surface uses it. Name it when converting.
   - ⚠ Its docblock lists six sections and it renders **seven**.

**LEAVE, verified:** `src/features/channels/components/go-public-dialog.tsx` (already on
`ConfirmDialog`; appears in the `ModalShell` grep only transitively),
`src/features/channels/components/channels-v2/posture-warning.tsx`,
`src/features/agent-templates/components/template-approval.tsx` (its docblock states the ruling: *"It
is the `ConfirmDialog` idiom, not that component"* — instructions run to 32 KB and need a bounded
scrolling well), `src/features/workspaces/components/join-request-notices-core.tsx` (a notice queue,
not a form).

### 4.3 Loading states + accessibility

| # | Item |
|---|---|
| **P6** | **Promote a web-tree `SkeletonSurface` equivalent into `src/shared/ui/skeleton.tsx` and have the desktop wrapper compose it.** Today `role="status"` + `aria-busy` sit on **2 of 8** exports; `TranscriptSkeleton`, `DetailPaneSkeleton`, `DetailDocSkeleton` announce **nothing** (= F-318). Closing it at the shared layer also closes the **four** hand-rolled announcement wrappers at call sites that §1A forbids: `src/features/chats/components/detail-pane.tsx › DetailPane` (F-318's unlisted third site), `src/features/members/components/members-v2/tab-access.tsx` and `› tab-activity.tsx`. ⚠ **THE COUNT WAS FOUR AND IS NOW THREE (2026-08-30)** — the fourth was the v1 members-table skeleton (`aria-live="polite"` where `role="status"` belongs), deleted with the v1 console under ASK-1. Plus the two composites that carry `aria-busy` and not `role="status"`: `src/features/skills/components/skill-view-skeleton.tsx › SkillViewSkeleton`, `src/features/ontology/components/ontology-skeleton.tsx › OntologyBoardSkeleton`. ⚠ **Do not over-fix** — both local composites are shape-mirroring and `TwoPaneListSkeleton` cannot express either. The defect is the missing attribute, not the local composite. |
| **P7** | **The reduced-motion opt-out has no path to the web tree.** `src/shared/ui/skeleton.tsx › Skeleton` is `animate-pulse` and **no web-tree rule stops it** under `prefers-reduced-motion` (`globals.css`'s block covers `.menu-card`/`.menu-row` only). Every web-tree skeleton — chats, members, skills, ontology, knowledge, channels — pulses through the preference. **PORT with ASK-9 attached**, because the honest fix contradicts §1A's *"the opt-out is on the SURFACE, not in the atom"*, which was written when the only surfaces were desktop ones. |
| **P8** | **Four hand-rolled `animate-pulse` blocks** — §1A: *"Never a locally hand-rolled pulse."* `src/shared/layout/settings-modal/sections/workspace-section-core.tsx` (**wrong tint** — `surface-raised-1`, the recipe is `-2`), `plans-billing-core.tsx › BillingSummary`, and `src/features/billing/components/upgrade-modal.tsx`'s `› GenericUpsell` and `› AddMemberBlocked`. None carries `data-slot="skeleton"`, an announcement, or the opt-out. |
| **P9** | **Geometry by reference, and the pin that would have caught it.** `apps/desktop-ui/src/pages/overview/overview-skeleton.tsx` restates `h-[104px]` ×3, `h-[228px]` ×2, `rounded-[14px]` ×6, `w-[124px]`, `w-[168px]`, and retypes `period-stats.tsx`'s well byte-for-byte; the one value it claims by reference does so **in a comment** over a re-typed class, and `activity-chart.tsx › PLOT_HEIGHT_CLASS` is module-local and unexported. `apps/desktop-ui/src/pages/channels/channels-skeleton.tsx` does the same for `w-[260px]`/`h-[52px]`/`h-[56px]`/`px-8 py-5`. **Also PORT the pin:** the four drift scans in `apps/desktop-ui/src/components/skeletons/page-skeletons.test.tsx` cover `/home`'s `kbCards`, the Agents grid, the knowledge ghosts and "each gate names its own skeleton" — **none checks overview or channels geometry**, which is why both drifted while green. |
| **P10** | ✅ **CLOSED 2026-08-30 — NOT PORTED, DELETED.** As audited, the v1 members-table skeleton's `ROW_GRID` resolved into a different table than the one it drew (§1A's 🔑 rule, violated concretely): a ghost `grid-cols-[16px_1fr_140px_140px_60px]` against the real row's `grid-cols-[minmax(200px,1.4fr)_110px_minmax(150px,1fr)_130px_32px]` — five columns each, **none of the five track values matching**, with the real one already exported. Samuel ruled the v1 console out (ASK-1) and both files went with it. |
| **P11** | **Text loaders in product chrome.** `src/shared/layout/app-shell/workspace-switcher-core.tsx`'s `<p>Loading…</p>` is the clearest — §1A rules it out outright. ⚠ **Do not fix the other 13 in isolation** — see ASK-8; it is one ruling, not fourteen edits. |

### 4.4 Realtime — `SYNC_TABLES` 17 → 5

Three subscriptions have **no second party** and can become refetch-on-focus. The primitive is
`src/shared/hooks/use-refetch-on-focus.ts › useRefetchOnFocus` (with a `skip` predicate); the
reference end-state is `apps/desktop-ui/src/pages/overview/index.tsx` (*"Cold read, deliberately: no
`supabase.channel()`, no poll"*).

- **`src/features/ontology/client/realtime.ts › useOntologyRealtime`** — **4 table filters, the
  largest set in the tree**, for a single-user graph. No presence, no conflict UI, no peer story
  anywhere in the feature.
- **`src/features/chats/client/realtime.ts › useChatsRealtime`** — single-player assistant threads;
  the only writers are the operator's own client (already optimistic) or an MCP agent. **Largest WAL
  saving of the three** — `chat_messages` is a high-write table.
- **`src/features/skills/client/realtime.ts › useSkillsRealtime`** — the replacement is **already
  wired in the same component** (`src/features/skills/components/skill-view.tsx` calls
  `useRefetchOnFocus`). ⚠ Its filter is workspace-wide, not skill-scoped, so every `skill_versions`
  retention-trim row — the highest-frequency delete in the schema — wakes the one open skill editor.

**Payoff:** twelve tables leave every binding list and, in the same release,
`supabase_realtime` — pinned both directions by `dopl-desktop-app/test/ui-sync-tables.test.mjs`. The
three highest-write names are all in the twelve. **Knowledge is the ASK, and must be split rather
than answered wholesale — ASK-10.**

⚠ Knowledge also uses `refetch()` on individual observers, **not** prefix invalidation — §7's
2026-08-20 correction (*"A DOORBELL INVALIDATES A PREFIX; IT DOES NOT REFETCH ONE OBSERVER"*) was
applied to channels and never back-ported. Chats already has the correct shape.

### 4.5 Logic + correctness ports

| # | Item |
|---|---|
| **P12** | **The sidebar "Upgrade to Pro" card renders for paying workspaces.** `src/shared/layout/app-shell/app-sidebar-core.tsx › AppSidebarCore` renders it **unconditionally** with no entitlement check and no billing props, on **every workspace page in both trees**. A Pro or Team customer is nagged forever. The hook exists and is exemplary (`useWorkspaceEntitlements` returns `isPaid`). Fix as a **prop or slot** from the host — the component is deliberately Next-free, same idiom as `AgentTemplatesCoreProps.loadingSkeleton`. |
| **P13** | **Keyboard-focusable, keyboard-inert tree rows.** `src/features/knowledge/components/knowledge-v2/list/tree-rows.tsx › FolderRow` and `› EntryRow` render `<div role="button" tabIndex={0}>` with **no `onKeyDown`**. A keyboard user Tabs onto every folder and file and Enter/Space does nothing. `src/features/knowledge/components/knowledge-v2/home/base-card.tsx › BaseCard` reasoned this contract out explicitly and got it right (*"ONE keyboard Open action… Tab order: bookmark, then Open"*); the rail never did. ⚠ Same file: `› RowIconBtn`'s docblock is false in **both halves** (*"rendered as a `<span>`: rows are `<button>`"* — it renders a `<button>` and the rows are `<div role="button">`). |
| **P14** | **`indexByParent` / `indexByFolder` sort the React-Query cache array in place.** Same file. `tree.folders` / `tree.entries` are cached query data. Two sibling files in the same feature get this right and say why (`detail/overview-contents.tsx` uses `[...folders].sort`; `home/knowledge-home.tsx` comments *"`[...bases]` because sort mutates"*). |
| **P15** | **The workspace bookmark fails silently.** `useToggleBaseStar` and `/home`'s `useStarToggle` have the same body and differ in two ways: the key source, and **`/home` toasts on failure while the workspace one does not**. On the workspace page a failed bookmark flips and flips back with no explanation. PORT the toast at minimum; the two should be one hook. |
| **P16** | **The client does not know the `guest` role exists.** `src/features/members/components/members-v2/view-model.ts › sectionOf` folds `guest` into "Members", whose section description reads *"Use everything: knowledge bases, skills, ontology"* — the exact opposite of a guest's grants — while `member-bits.tsx › ROLE_STYLE` and `member-facts.tsx › ROLE_COPY` both carry correct `guest` entries (the `Record<Role, …>` typing forced them). **The pill and the detail copy contradict the section header on the same screen.** ⚠ **A THIRD SITE WAS COUNTED HERE AND IS GONE (2026-08-30)** — the v1 members tab's role-filter options omitted `guest` entirely, so a guest row could never be filtered to; v1 was deleted under ASK-1, and v2's list pane has no role filter to fix. Narrow reachability today, but the exhaustive typing caught 2 of 4 sites and missed the two that are plain `if`/array literals — the shape that breaks the day guests reach a standard workspace. |
| **P17** | **`settings-modal-core.tsx › NAV` is role-blind.** It takes `role` and never reads it, so "General" and "Members" render for every role. For a **guest** both 404: General falls to *"Failed to load workspace"*, Members falls through to **D8's "No members yet."** Two error states presented as content. Gate both rows on `meetsMinRole(role, "viewer")`. Same root cause as ASK-2. |
| **P18** | **`/api/oauth` is a bare PREFIX over a whole subtree**, and two **user-session** routes sit inside it: `src/app/api/oauth/grants/route.ts` (`withUserAuth`) and `src/app/api/oauth/grants/[id]/route.ts` (`withUserAuth` + `sessionOnly`, with the comment *"an agent token must never revoke grants"*). Not an authz hole — both wrappers still run. But (a) they lose the Supabase cookie refresh, because `src/proxy.ts › config`'s negative lookahead excludes `api/oauth`, and that matcher's own docblock refuses to drop `/api/**` wholesale *for exactly this reason*; and (b) a route marked `sessionOnly` is simultaneously classified machine-authenticated. **Narrow both lists, then extend `src/proxy.test.ts` to assert `SELF_AUTH_ROUTES ∩ {routes using withUserAuth} = ∅`** — the prose contract exists and nothing executes it. |
| **P19** | **Two writes bypass the mutation layer with hand-typed keys.** `src/shared/layout/settings-modal/sections/account-section-core.tsx › handleSave` retypes `[PROFILE_PATH, undefined, undefined]` against §8 rule 1 — byte-identical to `apiQueryKey(PROFILE_PATH)` **today**, while `members-v2/hooks.ts › useProfileWrites` writes the same path correctly. Two writers of one entry, one by hand. And `src/features/members/hooks/use-invitation-writes.ts › resetJoinLinkConfig` has no `coldKeys`; it is safe only because the button is `disabled={busy || !token}` — a guard at the caller, not a property of the write. |

### 4.6 Chrome sweeps (mechanical, do last)

- **Small-button sweep, skills + ontology: 14 hand-written copies, `OpenScaleButton` appears 0×.**
  Two recipes — the 28px `btn-light … h-7 … rounded-md px-2.5 text-small` in **7** byte-identical
  copies (`skill-header-actions.tsx`, `ontology-view.tsx`, `attributes-editor.tsx`,
  `relationships-editor.tsx`, `template-editor.tsx`, `actions-editor.tsx`) and the 24px
  `h-6 … px-2 text-caption` pill in **7** more. ⚠ **Convert
  `src/features/skills/components/skill-folder-control.tsx › SkillFolderControl` with the caveat in
  hand** — its multi-word "Add folder" in a narrow row is precisely the `white-space: nowrap` +
  `flex-shrink: 0` failure that bit "New file" on 2026-08-28. ⚠ Ontology's 7 are **ASK-20**.
- **`ICON_BTN` (F-345): 5 live declarations**, all in `src/features/chats/components/list-pane.tsx`,
  `› detail-pane.tsx` and three `src/features/playground/components/panes/*.tsx`. **All five are one
  byte-identical string** — a cheaper, more mechanical promotion than F-345 implies. ⚠ Auditors split
  on whether the playground three are shippable — see §9.2.
- **Members chrome batch:** 18 distinct hand-written small-button recipes and 0 `OpenScaleButton`,
  including one with **no button face at all** (`workspace-icon-uploader.tsx`'s Remove).
  ⚠ **RE-MEASURE BEFORE ACTING: three of the sites counted here were DELETED on 2026-08-30** under
  Samuel's ASK-1 ruling — the v1 join-requests banner's Decline and pending-invitations' Revoke
  (both bare uppercase text), and the kebab menu in `src/features/members/components/team-bits.tsx`,
  which used a correct `Popover` but hand-rolled its rows and re-implemented `destructive` inline
  where `MenuItem` takes the prop. That kebab had exactly one caller, the v1 member row, and was
  removed as dead code in the same change. **The 18 is a 2026-08-30-stale number.**
  `› AccessLevelControl` hand-rolls a `role="radiogroup"` segmented control against DESIGN-SYSTEM's
  *"Never compose `.seg-pill`/`.seg-track`/`.raised-tab` tabs by hand."*
- **Billing chrome batch (framing first: billing is *old-correct*, not sloppy** — it predates
  `StandardDialog` and `OpenScaleButton` by days; weight accordingly): 15 copies of
  `h-8|h-9 … rounded-lg text-small`, and **6 copies** of the section-heading string over a bare
  `<section className="bento px-6 py-5">` that `SectionPanel` + `SECTION_PANEL_GROUND` already owns.
  `src/features/billing/components/billing-invoices.tsx` is the **one** `SectionBox` in billing, so
  the tree is currently inconsistent with itself, which settles it.
- **`period-stats.tsx › PeriodStats` is a third statement of the section pattern** — neither
  `SectionBox` (pressed-in) nor `SectionPanel` (flat, the workspace-page default since 2026-08-28) —
  on a page where every other section is a flat `.bento`. PORT to `SectionPanel`; that also deletes
  the duplicated recipe from the skeleton (P9).
- **Three danger zones hand-assemble the `SectionBox` frame** around `SECTION_BOX_INSET` — a fourth
  copy of the documented pattern: `sections/delete-account.tsx › DeleteAccount`,
  `src/features/workspaces/components/workspace-danger-zone-core.tsx › WorkspaceDangerZoneCore`,
  `apps/desktop-ui/src/components/settings-modal/account-actions.tsx › AccountActions`.
- **`apps/desktop-ui/src/pages/overview/overview-header.tsx › OverviewHeader`** — the page's only
  button is `h-8`; DESIGN-SYSTEM pins the black `auth-btn-3d` CTA at the app's **36px**. `h-9`.
  `apps/desktop-ui/src/components/page-states.tsx › PageError` uses `btn-light text-small px-3 py-1` — no height, no
  radius. Both fold into the `OpenScaleButton` batch.
- **`apps/desktop-ui/src/pages/home/link-out-panel.tsx › LinkOutPanel`** wears `FIELD_WELL` (a
  pressed-in recipe) on the page Samuel ruled *"nothing here is pressed in"*. It is not even an
  input — a read-only URL + copy button, which is exactly `wells.ts › RAISED_WELL`'s documented
  shape. **Swap it AND add the file to `HOME_FILES`** (G8) — the fix without the pin leaves the same
  hole for the next `/home` file. It has **two placements**, so the wrong face ships twice.
- **mcp-connect, end to end — smallest surface, largest per-line drift, one afternoon.**
  `src/features/mcp-connect/components/connected-apps-section.tsx › ConnectedAppsSection` ships a
  forbidden `<p>Loading…</p>` with no `role="status"`, a 24-word explainer, and a
  `toLocaleDateString()` with **no locale or format args** (renders differently per machine);
  `› remote-connect.tsx › RemoteConnect` carries a 38-word explainer against the 8-word ceiling
  `settings-agent-posture.test.tsx`'s sibling pins elsewhere. Both **fork `SectionBox`'s frame and
  label strip inline while importing `SECTION_BOX_INSET` from that same module**. ⚠ It is mounted
  **twice** and is the **only audited surface with no tests at all** — which is why it drifted
  quietly while chats did not.
- **Playground token bypasses:** `src/features/playground/components/playground-shell.module.css ›
  .frame` hand-mixes `border: 1px solid rgba(10,10,10,0.1)` + a two-drop shadow where `.bento` is the
  kit answer — the single colour-value offender in the whole legacy territory. Three prose sizes are
  **re-typed rather than imported** from `src/shared/editor/doc-editor.tsx › PROSE_CLASSES` (the
  values are sanctioned; the re-typing is the drift), and `text-[12.5px]` is exactly `text-body`, a
  straight miss.
- **Ontology token bypasses:** `src/features/ontology/components/object-panel.tsx › ObjectPanel`'s
  hand-tuned two-drop shadow where `.bento` is the answer; `› object-hover-card.tsx ›
  ObjectHoverCard`'s `bg-white` (should be `bg-bg-elevated`), `shadow-xl` (a Tailwind preset, not a
  kit elevation) and `z-[9999]`.
- **`src/features/agent-templates/components/template-editor-rows.tsx › ChipMultiSelect`** is a
  byte-identical hand-copy of `wells.ts › CHIP` — same border, fill, padding, type and the same
  `rgba(0,0,0,0.05)` literal — in a file that **already imports from `@/shared/ui/wells`**. One
  import.
- **`src/features/channels/components/channels-v2/bits.tsx › TAB_ACTION`'s split-button divider is
  `bg-white/25`** — the only raw-palette colour in the entire channels shell. One line.
- **Row geometry, four copies at three heights.**
  `src/features/channels/components/channels-v2/settings-tab.tsx › ActionRow` is `h-10` and its
  docblock calls it *"the `MetaRow` geometry as a button"*; `bits.tsx › MetaRow` is **`h-9`** and
  records the 2026-08-19 tightening. `thread-settings-tab.tsx` copies the `h-10` string with a
  comment saying *"if a third caller ever appears, promote it"* — a third and fourth now exist in
  `info-tab.tsx` at `h-9` and `h-[34px]`. Promote it as instructed, and say which docblock was wrong.

### 4.7 Bookkeeping, dead code and doc-side ports

- **`docs/MEMBERS-AUTHORIZATION.md` has no guest column and no measurement date** — last touched
  **6 days before the guest role existed**. Rules spot-checked still true. Add a Guest column (all ✖)
  + a date stamp, and check the roster `lastSeenAt` payload jointly (it is a guest-reachable read).
- **`POST /api/boot` is the unlisted twentieth guest route.** Floor is correct and lives in
  `src/features/workspaces/server/segment.ts › BOOT_MIN_ROLE`, structurally invisible to the
  route-file-parsing guest sweep. Name it in INVARIANTS §4A **or** state the sweep's scope limit in
  the test header. Related gap: `BOOT_MIN_ROLE` and `› MY_ACCESS_MIN_ROLE` are covered by exactly one
  behavioural test and no sweep — the same shape as the pre-hardening failure.
- **Four stale retired-era comments that will produce a confident wrong edit** — the exact hazard
  `CLAUDE.md` opens with: `src/shared/lib/url/post-auth-landing.ts`'s docblock documents a divergence
  from `safe-redirect.ts › POST_AUTH_LANDING_FALLBACK` that no longer exists (both are
  `/get-started`; `/canvas` was deleted 2026-08-11); `src/shared/lib/url/safe-redirect.ts`'s worked
  example is `"/canvas" → "/canvas"`; `src/shared/auth/public-routes.ts` calls `/invite/` *"Canvas
  invite acceptance"* (the rationale is right, the noun is three eras old);
  `src/shared/ui/skeleton.tsx`'s docblock lists "canvas" among single-surface pages.
- **`terms` and `privacy` still inventory a feature deleted 2026-08-11** — `src/app/terms/page.tsx`
  (*"visual canvas workspace"*), `src/app/privacy/page.tsx` (*"canvas configurations"*). ⚠ These are
  **KEEP-PUBLIC and legally load-bearing**: the login consent copy links them, the signed-out screen
  opens them, and **Stripe + Google OAuth verification expect live URLs**. A privacy policy that
  inventories data from a deleted feature is the one class of stale copy with an external auditor.
- **Dead exports in knowledge, verified by caller-grep:**
  `knowledge-v2/detail/view-model.ts › viewModel`'s `selection.kind === "entry"` branch is
  unreachable (its one caller synthesizes a base-kind selection), and `ViewModel.title` has zero
  consumers; `knowledge-v2/utils.ts › SCOPE_TINT` + `› baseTint` (three raw hexes, the superseded
  local scope palette the module replaced and says so) and `› initial` have **zero callers**;
  `› reportError` is declared **twice** inside one feature, byte-identical, alongside
  `src/features/knowledge/components/doc-pane-chrome.tsx › reportError`. ⚠ `knip.json` has no ignore
  covering `src/features/**`, so the dead-code gate did not catch these — worth asking why.
- **Three scope-label maps for three words.**
  `knowledge-v2/list-filters.ts › KB_SCOPE_CARD_LABEL` is a byte-identical duplicate of
  `src/features/knowledge/scope.ts › KB_SCOPE_LABEL`, and `› SCOPE_FILTERS` restates them a third
  time. The file's own comment admits the coupling; nothing pins it. (⚠ **Not** a three-scope-era
  leftover — private/team/workspace is knowledge's live model. LEAVE the model, PORT the triplication.)
- **The delete flow is written twice.** `knowledge-v2/detail/base-header.tsx › handleDeleteBase`'s
  comment says *"⚠ Must mirror base-settings-form.tsx's danger-zone delete"* — and it does, five
  calls deep, twice. One hook, two callers.
- **The three-wordings-of-one-fact copy consolidation.** *"Payment lives in your browser"* exists in
  three different sentences (`billing-page-screen.tsx`, `settings-modal/billing-pane.tsx`,
  `billing-plans-pane.tsx`). **Not** a minimal-copy deletion — the constraint is real and
  non-obvious — but three wordings of one fact is how a fact drifts. One exported string.
- **Minimal-copy deletions** (the ones that restate their own heading and carry zero information):
  `sections/workspace-section-core.tsx` *"Manage this workspace"*,
  `sections/account-section-core.tsx` *"Manage your personal account"*, (the settings members pane's
  *"Manage who can access this workspace"* was counted here and is gone — ASK-1, 2026-08-30) `members-v2/tab-settings.tsx`, `› tab-activity.tsx`, `› list-pane.tsx`,
  `overview-header.tsx`'s *"Today at a glance…"*, the three channels-dialog explainers, and
  `knowledge-v2/home/knowledge-home.tsx`'s hero paragraph.
  ⚠ **Do not delete the `subtitle` prop itself** — `members-v2/team-detail-pane.tsx`'s two uses state
  the *inheritance rule*, which the list does not show.
- **`knowledge-v2/home/knowledge-home.tsx`'s `text-[#e3e3e3]`** — the only raw hex in a knowledge
  `.tsx`, and it sits inside the design system's reference implementation.
- **Dead fixture typing:** `apps/desktop-ui/src/pages/agents/index.test.tsx › TEMPLATES` carries
  `teamId: null` — a field `AgentTemplate` does not have — and omits `teamIds` entirely. A
  single-team-era leftover; the array is unannotated so TS never catches it, and the page test
  therefore never exercises the real DTO.

---

## 5. RULED / LEAVE — so the next wave does not re-litigate

**Read this section before calling anything drift.**

**Design-system scope**
- **`SectionBox` is page-scoped, not deprecated.** The no-concave ruling is enforced by exactly one
  test — `template-editor.test.tsx › no concave surfaces` — whose sweep is `agent-templates/**` plus
  five hand-listed `/home` files. **Concave surfaces on ontology, members, chats, billing,
  mcp-connect and workspaces are NOT drift.** DESIGN-SYSTEM says there are two section patterns *"and
  picking one is a decision"*. **Do not mass-convert.**
- **`SECTION_BOX_INSET` sibling-reuse is sanctioned** at all eight rendered sites — the two
  1.22.0-era composer panels deliberately kept the concave body, which is itself evidence the ruling
  is page-scoped.
- **`FIELD_WELL` on ontology's add-rows** is its documented purpose.
- **`PageLoading` is not deprecated and must not be.** 10 mounts, a **10-for-10 match** against §1A's
  named list. `PageShellSkeleton` ×2, both sanctioned. **Do not grow a skeleton for Members or
  Settings** — §1A explicitly argues against it.
- **Settings forms keep `concave-field`.** `RAISED_INPUT`'s ⚠ is scoped to `StandardDialog`;
  `concave-field` remains THE input well on a page. Covers `workspace-section-core.tsx`,
  `account-section-core.tsx`, `workspace-settings-form-core.tsx`, `members-v2/tab-about.tsx`.
- **The 36px `channels-v2/bits.tsx › CARD_BUTTON` / `› TAB_ACTION` pair is a deliberate decision**,
  not the 26px drift `OpenScaleButton` was created to kill — their docblocks record Samuel's
  2026-08-24 ruling (*"there is no smaller 'card-sized' variant to drift back to"*). LEAVE the
  geometry (ASK-21 is about promotion, not size).
- **Billing's `h-8`/`h-9` full-width CTAs** are primary actions at control height, not the 26px pill.
- **`src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css › .cardGrid` vs
  `home.module.css › .kbCards` is a ruled divergence.** The card is **rebound, never forked** —
  `--kv-card-title-size` / `-weight` / `--kv-card-desc-lines` are defaulted aliases `.kbCards`
  overrides, and the workspace page never mounts `.kbCards`, so it keeps the defaults **by
  construction**. The 244→224 row height is derived arithmetic, written down. **Do not "unify" these.**
- **Stripe hex is correct and must stay.** `checkout-appearance.ts` is ~30 hex literals because
  Stripe's Appearance API takes values, not custom properties, and the Payment Element renders in a
  cross-origin iframe. It maintains an explicit token→hex table. (The single `#646d78` is D10.)
- **`src/features/members/constants.ts`'s eight team colours** are identity data, not UI recipe —
  DESIGN-SYSTEM carves this out by name.
- **`src/shared/design/liquid-glass/liquid-glass.tsx`'s `tintColor = "#ffffff"`** is a component API
  default, not a painted value.
- **Marketing, auth and onboarding are exempt by name** and measure **0 forbidden type utilities**
  anyway. Auditing them against the app kit is a category error. `src/app/admin/**`'s 35 type hits
  are single-operator internal tools behind `isAdmin` + `notFound()`.
- **`apps/desktop-ui/src/components/app-shell/account-rail.tsx › AccountRail`** is a model shell component —
  composes kit `.raised-tab`, and **every** magic number carries a dated arithmetic justification.
- **`workspace-switcher-core.tsx`'s hand-rolled workspace rows LEAVE** — `MenuItem` has no
  radio/checked affordance, so this is a real gap in the primitive, not a shortcut. ⚠ It is a fifth
  hand-composition of `.menu-row`; if a sixth appears, grow the variant.

**Guest lane (ruled, named, not ledgered)**
- Guest keeps the **5-tab info panel including Knowledge** — F-340 RESOLVED 2026-08-27 by option (E),
  pinned **in both directions** by `channels-v2/knowledge-tab.test.tsx`.
- **No `role` prop passed to the surface** — Ruling R4 (rewritten 2026-08-26),
  `docs/specs/guest-role.plan.md` §3: the server is the fence.
- **`memberManagement: false` + `selfManagement: false` as one flag-pair story** — Rulings R2/R3,
  2026-08-25, pinned by `guest-surface-reads.test.tsx`.
- **`/c` absent from `PUBLIC_ROUTES` and from `layout-shell.tsx › NON_WORKSPACE_ROOTS`** — both
  deliberate, both documented in-file.
- **`channel-surface-standalone.tsx › StandaloneChannelSurface`'s `role = "member"` default** —
  harmless today (every `role` reader on this surface is an admin floor), but it is fail-**open**;
  worth a docblock note, not a change.
- **The guest lane's §8 and fall-open scans are CLEAN** — three `?? true` hits, all correct;
  `channels-v2/knowledge-lane.ts › canEditGranted` is fail-**closed** on an absent grant, and the
  lane carries the tree's highest per-key `?? EMPTY_X` count with a §8 citation.
- **F-330 is unreachable in the guest lane** — the guest Knowledge tab reads `knowledge-lane.ts`,
  never `use-knowledge-v2-trees.ts`.

**Role floors and auth**
- **Both wrapper families, all 19 guest floors, the 4 knowledge-lane fences, the 10 viewer-floored
  own-scoped writes, the `/api/home` family, icon DELETE + invitation DELETE, and the guest RSC
  pages: verified end to end.** `scripts/check-role-drift.ts` is an honest set-and-coverage gate and
  **cannot see floors** — that is `guest-route-floor` + `api-workspace-floor`'s job, and they do it.
- **Routes added since the hardening (4 files + 10 MCP modules) all conform.** The
  `mcp-container-token` POST docblock is the model artifact — its first draft was guest and it was
  argued back up.
- **MCP tools touch data only via `@dopl/client`** (0 direct supabase/fetch), so they inherit route
  floors verbatim. (The **absence** of a bypass is unpinned — ASK-24.)
- **Billing floors are correct and fail-closed end to end**, including `src/app/billing/[segment]/page.tsx`,
  where a guest 404s **at the page**, not just the API.
- **Overview's floors are correct and documented**, and `channelId` is fenced through
  `service-overview.ts › isChannelVisibleTo`.
- **Skills' three unfloored body-returning GETs all chase the row up to what owns it** — the
  2026-08-26 knowledge-entry lesson was absorbed. (A file-level grep suggests an asymmetry on
  `skills/[skillSlug]/route.ts`; reading per-export disproves it. Recorded so it is not re-derived.)
- **The `/api/home/link/` vs `/api/home/links` hazard is closed by the trailing slash**, verified
  mechanically against all 156 route paths. **No other one-character-from-public route exists.**

**Stale cache (§8)**
- **The non-home tree is far more compliant in SUBSTANCE than the marker census suggests:** 11 of 12
  post-persister payload fields already carry correct fallbacks. What never crossed over is the
  **notation** and the **test half**.
- **Verified safe, with reasons:** overview payload fields (route path changed in the same commit, so
  no stale entry can exist — see §9.1), `infoCard`, `myFavoritedAt` (`!= null` by design),
  `workspaceRole` (fail-safe, pinned), `lastActivityAt` (optional type), session telemetry
  (null-means-unknown throughout — exemplary), knowledge list siblings, `channelGrants`, homeScoped id
  lists, template payload (whole type shipped in one commit), `memberCount`/`kind`
  (inverted-fail-closed, deliberate), teams/chats/ontology (pre-persister or reducer-driven).
- **Primary-key selectors without `?? []` are not §8** (a primary key is never absent) — a cheap
  consistency sweep at most.
- **The members write layer is exemplary and has no `?.`-on-the-container mistake anywhere.**
- **The channels hooks are the model implementation** — `knowledge-tab.tsx › BaseContents` pairs a
  container guard **and** a per-key fallback, which is the counter-example to D2.

**Realtime**
- **Zero raw `supabase.channel()` in feature code** — §7's rule holds perfectly. Every one of the 17
  `SYNC_TABLES` maps to a mounted subscriber on a shipped page: **no orphaned publication, no
  orphaned subscription.** The 82.7% history is closed.
- **`shared-channel-registry.ts › subscribeSharedWorkspaceTables` is the fix, not the problem.**
- **F-300's linearity is entirely in desktop main**, on two axes, and F-300 explicitly forbids the
  obvious fix. `usePresence` is socket-only and costs no DB.
- **Presence/consent ratio couplings fail safe.** **Model catalog is fail-open by design.**
- **Overview, Members, Settings, Billing, Shell and Onboarding hold no subscription** — already the
  target shape. The shell's workspace-wide consent subscription was **deleted 2026-08-25** with a
  do-not-re-add note.
- **Channels' realtime is a documented §7 exception** (the doorbell model under
  `connect-src 'none'`), not drift.
- **No publication residue.** Four tables ADDed and never explicitly DROPped turn out to be dropped
  **tables** that left via CASCADE. ⚠ Two `ALTER PUBLICATION` sites use a `format(… %I, tbl)` loop a
  text scan cannot see — a live `select * from pg_publication_tables` remains the only authority.

**Duplicated rules that are GATED (the working models)**
Role set (9 sites incl. SQL + dist), workspace field mirror, knowledge interfaces, **mention grammar**
(a source-slicing parity test + shared length-pinned fixtures — the model), tint↔stamp, MCP tool
vocab, `SYNC_TABLES` re-derivation, `WORKSPACE_PAGES`↔`routes.tsx`, **version floors including the
deliberate non-coupling of declared-latest vs `package.json`**, launch-directive wire, runtime stamps,
model catalog, channels/knowledge schema-sql. **Bounded/inert:** the reconnect ladder ×2, `InvitedRole`
+ link-grant subsets (the SPA's narrower grant set is Samuel's documented ruling; the SQL/zod pair is
self-verifying). **Wake tiers are a single module with exported bounds "so tests cannot restate them" —
clean.**

**Retired eras**
- **Behavioural dead code: none in any territory.** The retirements were done properly —
  `RETIRED_RESOURCE_TYPES` filters at the boundary while the DB CHECK deliberately still accepts the
  value, and three separate files say *why* `workflow` is absent from the UI and present in the data.
- **`session-window` survives only as prose explaining what was deleted.** F-228 recorded as resolved.
  `auto-grow-textarea.ts`'s "session window's cap: three lines" names **live math**.
- **`RESERVED_WORKSPACE_SLUGS` keeps `"canvas"`** — un-reserving lets someone claim a slug legacy URLs
  may still point at. Reserving costs nothing.
- **`src/app/receipt-test`** — a 12-line animation sandbox that costs nothing but a public URL. Delete
  it the next time anyone touches `public-routes.ts` (e.g. for P18).
- **`useApiGet` and the F-022 `Button`/`Dialog` primitives measure 0 repo-wide** — those retirements
  really are complete.

**Correct and specifically checked (recorded so it is not re-audited)**
Raw agent ids: clean, and enforced by a source sweep rather than review (`agent-id-visibility.test.ts`
reads every `.tsx` in the directory, comments stripped). Native `<select>`: zero in any audited
territory (3 remain, all ontology). `useApiQuery` divergence in knowledge: reasoned — the layer cannot
express a predicate invalidation and knowledge needs exactly that. `agent-templates`' §1A compliance at
**both** gates is textbook. The agents territory has no dead exports, no fall-open, no url-sync debt
(and §5A says the absence of an `agents/:templateId` row is **load-bearing**). `/link/[token]` is a
model of house style. **There is no MAP or everywhere-SEARCH UI** — `dopl_map` and `dopl_search` are
MCP-only; the territory item is closed, not open. **The flagged "launch-sheet keeps a concave pill"
claim is FALSE** — that file has no concave surface and the sweep does see it; the concave pill on a
template-launch surface is `channels-v2/composer-launch-panel.tsx`, in a feature where the recessed
composer body is the ruled idiom.

---

## 6. ASK SAMUEL

Every open question from all seven reports, consolidated and deduplicated. Options, then the
auditor's recommendation. **Numbered so they can be answered by number.**

> **RULED so far (Samuel, 2026-08-30):** ASK-1, ASK-2, ASK-5, ASK-6 — plus ASK-21, which was never a
> product question (it is §5A enforcement) and is now DONE. Each is annotated in place below.
> **A ruling is not a recommendation adopted** — read the annotation, not the auditor's line above it.

**Product direction**

1. **Delete the v1 members console?** Two complete consoles rendered the same data from the same
   cache entries: v2 (`members-v2/**`, 14 files, mounted by `/members`) and v1 — a members tab, a
   member row, a table skeleton, a pending-invitations list and a join-requests banner, five files
   under `src/features/members/components/`, mounted **only** by the settings modal's members pane.
   **Both members bugs (D8, P10) lived in v1.**
   (a) Delete v1 and drop the settings members pane; (b) delete v1 and point the pane at v2;
   (c) keep both and port v1's chrome. → **Recommend (b).** Porting a deletion candidate is the wrong
   order of work, and this blocks the scope of D8 and P10.
   → ✅ **RULED (a), 2026-08-30 — Samuel. DONE.** *Not* the recommendation: the pane goes too, so
   `/members` is the ONE console. All five v1 files are deleted, along with the settings modal's
   members section and the `"members"` member of
   `src/shared/layout/settings-modal/settings-modal-core.tsx › SettingsSection` — **delete, don't
   disarm: there is no nav stub.** `› SettingsModalCore` lost
   `workspaceSegment`/`workspaceId`/`currentUserId`/`role` with it, because it now owns no pane of
   its own. **This CLOSES D8 and P10** — both bugs were v1's and died with it; v2's failed-read guard
   was verified in place (`src/features/members/components/members-v2/members-v2-view.tsx`, *"A
   FAILED roster read must not fall through to the panes"*). Two exports the deletion orphaned were
   removed in the same change — the v1 filter dropdown out of
   `src/features/members/components/member-bits.tsx`, and the kebab menu out of
   `src/features/members/components/team-bits.tsx` (see §4.6, where both were counted). ⚠ **P17
   shrinks but does not close**: `settings-modal-core.tsx › NAV` is still role-blind, and its
   "General" row still 404s for a guest — only the Members half of that finding is moot.

2. **What should a guest actually SEE at a workspace URL?** `segment.ts › BOOT_MIN_ROLE` is `"guest"`
   deliberately and `app-shell.tsx › AppShellLayout` **adds no floor of its own** — so a guest
   reaching `/{linkContainerSegment}` gets the shell in full (8-row nav, upsell card, settings gear,
   switcher, providers, banners) and then every routed page 403s at the `viewer` default: **fully
   painted chrome around a stack of `PageError` cards.** Not a live leak (nothing links a guest
   there); URL-reachable. (a) A scoped shell; (b) redirect to their channel; (c) the signed-out
   screen. → **Recommend (b).** The shell floor itself is a PORT either way, and P17 is the same root
   cause one level down.
   → ✅ **RULED (b), 2026-08-30 — Samuel. DONE.** The redirect lives at the SHELL layer
   (`apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout`), **not** in the floor:
   `BOOT_MIN_ROLE` stays `"guest"` because the two pop-out windows live outside that layout and pay
   the boot read themselves — a `viewer` floor 404s them. The container's one channel is resolved the
   way the guest web lane resolves it (`/c/{workspaceId}` → `getHomeChannel`; the renderer's twin is
   `GET /api/home/channels`, matched on `workspaceId`), and the no-channel edge falls back to
   `/home`. Pinned + mutation-verified in
   `apps/desktop-ui/src/components/app-shell/app-shell-guest.test.tsx` (6 cases, 5 reverts).
   ⚠ **The shell CHROME question is untouched and is still the PORT the auditor named** — a guest
   now lands somewhere that works, still wearing a nav they cannot use.

3. **Should the sidebar "Upgrade to Pro" card exist at all** now that billing has its own page **and**
   a settings pane? (a) Keep and gate on `isPaid` (P12); (b) delete the card. → **Recommend (a) for
   now** — P12 is the bug fix regardless; deleting is a marketing call.

4. **Is the upgrade modal in scope this wave?** `src/features/billing/components/upgrade-modal.tsx` is
   **551 lines**, over the cap, named in `eslint.config.mjs`'s closed list carrying *"DO NOT ADD TO
   THIS LIST — split the file instead."* It holds seven components, and `GenericUpsell` /
   `AddMemberBlocked` are near-duplicate bodies with duplicated `hasLiveSub` and switch-to-Team
   wiring — so the split is real work with a real payoff, not a file cut. It also wants a
   `StandardDialog` conversion (no close X at all; `<div className="p-6">` with **no `max-h` and no
   `overflow-y-auto`**, so a tall checkout has no scroll container). (a) Both at once; (b) neither;
   (c) the split only. → **Recommend (b) this wave, (a) next** — doing them separately pays the read
   twice on a payment surface with a 722-line test suite.

5. **Keep or kill the fake hero chat?** The `HeroChat` under
   `src/features/knowledge/components/knowledge-v2/home/` was 215 lines of composer, auto-grow
   textarea, IME guard, live region and reduced-motion animation **wired to nothing** — its own
   docblock said *"DESIGN ONLY… Send appends a HARDCODED reply."* It was **live** on the workspace
   Knowledge page (gated only on `heroImageSrc`, which the page passes). `/home` has no equivalent. One of its hints ships an internal implementation note to the user
   (*"Dictation is not wired up yet — this is the pressed state only"*). (a) Delete with the hero;
   (b) keep and fix its hex + copy. → **Recommend (a).** A non-functional chat on a workspace page
   teaches users the product is fake.
   → ✅ **RULED (a), 2026-08-30 — Samuel. DONE.** The component and its suite are deleted, the mount
   is gone from
   `src/features/knowledge/components/knowledge-v2/home/knowledge-home.tsx`, and the four orphaned rules
   (`.heroChatReveal`, `.heroChatRevealInner`, `.heroChatLog` + its reduced-motion block) are gone
   from `knowledge-v2.module.css`. ⚠ **THE HERO IMAGE STAYS AND THE BAND IS UNCHANGED** — the ruling
   was "remove the fake chat", not "redesign the landing", so `.homeHero`'s column layout is left as
   written rather than collapsed. `knowledge-home.test.tsx`'s hero section is rewritten to assert the
   ABSENCE against the composer's CONTROLS (textbox / send / dictate), so re-adding the same chat
   under another name fails it too. ⚠ Leftover: `shared/ui/auto-grow-textarea.ts › useAutoGrowTextarea`
   now has NO caller (its `growHeight` half keeps its own test). Not deleted here — it is a shared
   primitive named in DESIGN-SYSTEM and in §4.7's doc-correction list.

6. **Nav priority vs. product direction.** `apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES` orders:
   Overview, **Ontology**, Knowledge, Skills, Chats, **Channels**, Agents, Members, Settings. If
   channels is the lead product and ontology is substrate, the shipped sidebar says the opposite —
   ontology second, channels sixth. **No doc records a demotion.** (a) Reorder; (b) the reading of
   the direction is wrong; (c) leave and record why. → **Recommend a ruling before any reorder** —
   this is either a stale nav or a misread, and the auditor cannot tell which.
   → ✅ **RULED (a) — CHANNELS-FIRST, 2026-08-30 — Samuel. DONE.** It was a stale nav. New order:
   **Overview, Channels, Agents, Knowledge, Skills, Ontology, Chats, Members, Settings.** ⚠ **THE
   ORDER LIVES IN TWO HAND-KEPT LISTS AND THE AUDIT NAMED ONLY ONE.** `routes.tsx ›
   WORKSPACE_PAGES` registers the routes; `src/shared/layout/app-shell/app-sidebar-core.tsx › NAV`
   is what actually DRAWS the rail, and neither can import the other (the sidebar core is shared
   with the web tree). **Both are reordered, and a new case in `routes.test.tsx` compares them** —
   before this, reordering one and not the other was invisible. ⚠ `deep-link-target.js ›
   WORKSPACE_PAGES` needed **no edit**: it is an object keyed by page, its value answers "has a
   `:param` child", and its drift test sorts both sides before comparing. Ruling recorded, dated, at
   both list definitions.

7. **How much to invest in Skills / Ontology / Chats at all?** They are **not** scheduled to die —
   all three are live top-level nav rows, so their drift is genuine debt. But if they are
   *strategically* de-emphasised behind channels, the right answer may be "fix mcp-connect and the
   `ICON_BTN` pair, and stop", not the full §4.6 sweep. → **Recommend scoping to the correctness
   items (P6/P7's `role="status"`, and the six sub-page text loaders) and deferring the button
   sweeps.** The audit can
   tell you the debt is real; it cannot tell you the surfaces are worth it.

**Rules that need scoping, not enforcing**

8. **Scope the "no text loaders" rule.** DESIGN-SYSTEM states it in the imperative; the tree has
   **14 live sites** and **every one is inside a popover, a menu or a small section — never a page**,
   while §1A separately says *"DO NOT CREATE A LOADING STATE WHERE NONE EXISTS"* and scopes skeletons
   to pages. (a) Scope the rule to loading **surfaces** (page/pane) and let a 288px dropdown keep a
   line of text; (b) accept 14 sites of debt and fix them. → **Recommend (a)**, with the one genuine
   violation fixed regardless (`workspace-switcher-core.tsx`, P11). It is one ruling, not fourteen
   edits.

9. **Can the web tree get the reduced-motion skeleton opt-out?** §1A says *"the opt-out is on the
   SURFACE, not in the atom, because that atom is the web tree's too"* — written when the only
   surfaces were desktop ones. The consequence is that **every** web-tree skeleton pulses through the
   preference. (a) Promote `SkeletonSurface` into `src/shared/ui/` and have the desktop wrapper
   compose it; (b) add a `@media (prefers-reduced-motion: reduce)` rule in `globals.css` neutralising
   `animate-pulse` on `[data-slot="skeleton"]` (contradicts §1A as written); (c) record a web
   exemption. → **Recommend (a)** — it closes F-318, P6, P7, the billing call sites and the guest
   lane's ghost in one move, and it is the §-thesis fix (one primitive, second call site).
   *(Consolidates: core-pages §11.4, knowledge F-K21, guest G7, cross-cutting §1.13/§1.15.)*

10. **Is knowledge still multi-editor?** `src/features/knowledge/components/doc-pane.tsx` ships real
    multi-editor support — `usePresence`, an `otherEditors` list, a 412 no-stomp conflict path and a
    discard-mine dialog — so **a second human editor is a designed-for case on the entry pane**. The
    *base list* and the *tree* have no such story, and the hook's own comment says its driver is
    *"MCP/CLI agents + other tabs"*, not a person. (a) Single-operator → PORT all three tables and
    delete `use-presence.ts` with it (no other caller); (b) multi-editor stays → keep the
    entry-scoped feed, PORT the base/tree half. → **Recommend (b)** — the conflict machinery exists
    and was built deliberately; deleting a designed-for case to save one table is the wrong trade.

11. **Is `CACHE-SHAPE FALLBACK` the house marker or `/home`-local?** INVARIANTS §5's measurement
    command is scoped to `apps/desktop-ui/src` and answers **2** (both `/home`) while **11
    substantively-compliant non-home sites are invisible to it**. (a) House marker ⇒ comment-sweep
    the 11 and widen the measurement to `src apps packages`; (b) `/home` convention ⇒ fix the
    measurement line. → **Recommend (a).** This decides what every future §8 census means, and a
    census that cannot see 11 compliant sites will keep producing false alarms.

12. **Should `.search-expand` be the app-wide search control or `/home`'s?** Nothing in
    DESIGN-SYSTEM scopes it to `/home` (unlike the four `home-*` colour tokens, which are explicitly
    page-only). Today `knowledge-home.tsx` uses a plain `SearchField` and
    `detail/base-header.tsx` puts `KnowledgeSearch` inside `hidden lg:block`, so **at narrow widths
    an opened base has no search affordance at all** — it is removed from the DOM. → **Recommend
    app-wide**; both knowledge heads then port onto it and the disappearance goes away.

13. **Which dialog family does a per-resource SETTINGS dialog belong to?**
    `src/features/knowledge/components/base-settings-modal.tsx` composes `ModalShell size="narrow"` +
    the settings-modal internals. `StandardDialog` is documented as *"THE create/edit dialog"* and its
    named converts are all **creates**. (a) `StandardDialog`; (b) the settings-modal family, formally
    recorded. → **Recommend deciding before P8's conversion lands**, though the field/section/button
    fixes are worth doing either way because both families forbid a hand-rolled field face. *(Same
    question covers `move-to-dialog.tsx`, `kb-scope-controls.tsx`, `launch-sheet.tsx` and
    `join-request-notices-core.tsx` — the picker/sheet shapes.)*

**Permissions and security**

14. **Should `BaseHeader`'s destructive controls take `canEdit`?** (D4.) → **Recommend yes**, closed
    by default, matching `kb-channel-grants-section.tsx`'s server-supplied pattern.

15. **The guest lane's dead buttons: delete outright, or thread `memberManagement` into the info
    column?** An external link-claimed person currently gets an "Add member" button refused at two
    layers. (a) Delete — matches the "delete don't disarm" ruling; (b) thread the capability. →
    **Recommend (a)**, and fix `memberManagement`'s docblock, which claims a scope it does not have.

16. **The guest lane's fixture data.** F-316 parks the activity-strip wiring on a perf argument (31
    counted bins on every click through a channel tree). **That argument is inverted on the guest
    lane** — one channel, opened deliberately, exactly `/home`'s case, and `/home` **is** wired.
    Linked threads has no finding at all. (a) Wire both on the guest lane; (b) delete both there;
    (c) leave. → **Recommend (a) for activity, (b) for linked threads.** *(Same decision covers the
    channels page's twin — core-pages §8.8.)*

17. **`sessionOnly` on four agent-reachable writes — answer once for all four.** All are `withUserAuth`
    with no `sessionOnly`, so an OAuth bearer with `dopl.write` reaches them: **`PATCH /api/user/profile`**
    (writes `display_name` — the one peer-controlled string MCP output renders outside the untrusted-body
    header; the forgery vector is closed by `SAFE_LABEL_RE` + a DB CHECK, but the **caller type is
    not gated**, so an agent can rename its own operator), **`PATCH /api/workspaces/[slug]`** (renames
    the workspace and moves the canonical URL — **`DELETE` on the same file carries `sessionOnly`;
    `PATCH` does not**), **`POST /api/onboarding/complete`** (renames the default workspace and stamps
    a one-way lifecycle flag), and **`POST /api/workspaces`** / **`ensure-default`**. Contrast
    `PATCH /api/channels/[channelId]/members`, gated method-wide because *"a favourite is the
    OPERATOR's own sidebar shortcut list."* → **Recommend `sessionOnly` on profile and workspace
    rename; leave the onboarding pair open** (they run before the user has a workspace). Adding it is
    a capability removal that could break an MCP flow, hence the ask.

18. **Should `GET /api/workspaces` narrow to `[lockedTo]` server-side under a container lock?** The
    unfiltered-by-contract ruling predates the lock having a producer. → **Recommend yes** — if so,
    D13 and this are one fix.

19. **Is a guest becoming OWNER of their own container intended?** A guest may `POST /api/home/channels`
    and own the result, thereby clearing the member mint-floor there. Almost certainly intended;
    **entirely unstated in §4A**. → **Recommend: state it in §4A**, whichever way it is ruled.

20. **Should `packages/mcp-server/src/tools/` carry an absence-pin** asserting "no tool bypasses
    `@dopl/client`"? Surface v2's entire floor conformance rests on that **unpinned** property. →
    **Recommend yes** — a source sweep, the same shape as `agent-id-visibility.test.ts`.

21. **The launch panel lost the authorship security signal.**
    `channels-v2/composer-launch-panel.tsx › AgentLaunchPanelView` (2026-08-27) replaced the composer's
    template chevron and narrows the list to `› LaunchTemplateOption = {id, name}` — **no
    `authorMarker`, no visibility, nothing in the accessible name.** The picker that carries the signal
    is now mounted from exactly one place. §5A calls the marker *"a SECURITY SIGNAL, NOT DECORATION…
    the ONLY signal shown to the human BEFORE the choice is made."* `TemplateApprovalDialog` still
    fires on first use, so the fence holds — what was lost is the **pre-choice** signal on the surface
    now taking most of the traffic. → **Recommend restoring the marker to the panel.** This is a
    security ruling, not a design one.
    → ✅ **DONE, 2026-08-30 — and it was never a question.** §5A already ruled it; this was
    enforcement, not a decision. `LaunchTemplateOption` regains `marker`, filled in `ComposerLaunch`
    by `template-picker.tsx › authorMarker` — **the same function, never a second copy**, so a
    nameless author still reads *"by another member"* rather than losing the marker. It reaches the
    ACCESSIBLE NAME via `MenuItem`'s `description`, which renders inside the `role="menuitem"`
    button — the same two places the picker puts it. `composer.tsx` now hands the panel
    `currentUserId` + the CHANNEL roster (not the workspace's, for the reason `agents-tab.tsx`
    states). Pinned + mutation-verified in `composer-launch-marker.test.tsx` (5 cases, 5 reverts,
    0 vacuous).

22. **Is `/oauth/authorize` inside the auth exemption?** It carries 13 forbidden type hits. It is the
    MCP/Claude-connector consent screen — KEEP-CRITICAL, and plausibly the highest-traffic
    non-landing page in the product — but it lives **outside** the `(auth)` route group.
    → **Recommend: inside the exemption, stated explicitly in DESIGN-SYSTEM.** If not, it is the
    most-seen surface carrying drift.

23. **Should `/agents` have a role floor?** `useWorkspaceAccess` returns `role` and `isAdmin`; the
    seam passes neither. A **viewer** sees a live "New template" button and a fully editable modal;
    the routes floor at `member`, so the click 403s into the editor's `role="alert"`. §5A's "no UI
    gate" blessing is about **guests on `/home`**, not viewers here. → **Recommend gating the button
    on `meetsMinRole(role, "member")`.**

**Design decisions**

24. **Do the two 28px `IconButton`s become one primitive?**
    `members-v2/bits.tsx › IconButton` and `channels-v2/icon-button.tsx › IconButton` are near-twins
    that have **already drifted**: channels rests at `text-text-secondary`, members at
    `text-text-muted`; members carries `cursor-pointer` + `disabled:opacity-40`, channels
    `disabled && "cursor-not-allowed opacity-50"`; channels adds `active`/`filled`/`bare` variants
    members lacks. ⚠ **F-345's proposed settlement names the wrong module** (see §7), so a promotion
    following it as written would carry the wrong variant set. Two more hand-rolled bare buttons at
    their own sizes fold into whatever this produces (`sidebar-branch.tsx › ChannelBranch` at 24px;
    `invite-dialog.tsx`'s ⊖ remove at 24px), as do the CSS-module copies of the same face
    (`knowledge-v2.module.css › .treeActionBtn` at 22px, `› .cardStar` at 26px). →
    **Recommend one primitive with a `bare` variant, taking channels' variant set** — `.cardStar` is
    already 26px, i.e. `OpenScaleIconButton`'s geometry with a bare face. **Fix F-345 first.**

25. **Do the 36px `CARD_BUTTON` / `TAB_ACTION` pair earn a primitive?** They are hand-written string
    constants, appear nowhere in DESIGN-SYSTEM's table, and `agents-tab.tsx` has **already had to
    hand-re-cut `TAB_ACTION`** for a split button, leaving a ⚠ saying it *"must be re-cut with it
    whenever that constant moves"* — the F-345 failure mode arriving one size up. So the 36px pair is
    undocumented while the 26px pill is pinned by a test. → **Recommend yes**, or at minimum a
    DESIGN-SYSTEM row.

26. **Does the raw-id rule generalise beyond agent ids?** `members-v2/view-model.ts › displayNameOf`
    terminates in a **raw user UUID** (`row.displayName || row.email || row.userId`), consumed by the
    detail header, roster rows, team rosters, the avatar stack and every `aria-label` in
    `team-detail-pane.tsx` — and **restated inline, not through the helper, in four more places**,
    plus a raw *resource* UUID in `team-detail-pane.tsx`. §11's rule is scoped to **agent** ids, so
    this is not a violation as written — but it is the same failure, and §11's fallback design
    (`Agent #<id>`, *"a NAME the operator was shown at launch"*) is the precedent. → **Recommend yes,
    and collapse the five restatements into the one helper first.**

27. **Does `SegmentedControl` grow an underline variant, or does the members header earn a documented
    exception?** `members-v2/member-header.tsx` hand-rolls a `role="tablist"` with an
    `absolute … h-[2px]` underline. An underline tab row is a genuinely different affordance from a
    pill row and `SegmentedControl` cannot express it. → **Recommend a documented exception** — one
    site does not buy a variant.

28. **Should `.bento` get a hover face?** `agent-templates/components/template-section.tsx ›
    TemplateCard` hand-writes a double shadow that is the **tree's only occurrence**; `.bento` has no
    hover state and `.kanban-card` already owns *"a shallow hover lift."* → **Recommend reusing
    `.kanban-card`'s lift** rather than minting a third elevation.

29. **The menu divider inset differs between the two menu implementations** — `globals.css` uses
    `7px 2px` / `--border-subtle`; `marketing.css` uses `7px 9px` / `--line`. **No record of which is
    intended.** → **Recommend `globals.css` wins** (it wins D5 for the same reason), unless the
    marketing card's wider inset is deliberate.

30. **Backtick-mention wake asymmetry.** A backticked `` `@agent` `` mention **tints nobody** in the
    transcript but **does wake the agent** — the code-mask rule exists only on the tint reader, not on
    the wake path. → **One sentence settles it.** Recommend: **mask both**, so what the human sees and
    what wakes an agent are the same rule.

31. **`layout-shell.tsx`'s `#2c3640` vs `bg-home-frame`'s `#2f3542`.** An imperative body paint that
    is neither a `--bg-*` token nor the documented frame colour. Two near-identical dark slabs one hex
    apart is exactly the drift the `home-*` palette note warns about. → **Recommend collapsing to one
    token**, but which one is Samuel's call.
    ✅ **SETTLED 2026-08-30 (Samuel, live review): home-frame wins, one token.** `layout-shell.tsx`
    now assigns `var(--home-frame)`; the dead `--rail: #2c3640` is deleted from both token copies and
    `--body-bg` reads `var(--home-frame)`. No `#2c3640` value remains in either tree (only prose
    naming what it was). Landed with the frame-model ruling — the workspace shell adopts /home's
    frame and palette; see `docs/DESIGN-SYSTEM.md`.

32. **`DiffModal`'s width.** It needs `max-w-4xl`; `StandardDialog` is fixed at `min(92vw, 640px)` and
    the doc says that is **not a prop**. Either the diff gets a `ModalShell` at a wide size (a second
    dialog face in the system) or the diff is redesigned to 640px. → **Recommend `ModalShell` wide,
    documented as a named size** — a diff at 640px is not a diff. Blocks §4.2's item 4.

33. **Do the settings-modal "Folder descriptions" section and the Grants subtitle survive?**
    `base-settings-form.tsx › FolderDescriptionRow` edits `folder.description` — **the same field, for
    the same folders**, that `detail/overview-contents.tsx › ContentRow` now edits inline in the info
    face, with different save semantics (blur-only vs Enter/blur/Escape) — and `OverviewContents` also
    covers *entries*, which this section cannot. Reads as a pre-overhaul remnant. Separately:
    `team-detail-pane.tsx`'s Grants subtitle is the wordier twin of a subtitle already kept. →
    **Recommend deleting both**, but they are copy/product calls.

34. **Should `formatRelativeTime`/`formatDate` grow the two knowledge shapes, or does the doc's
    absolute claim get amended?** DESIGN-SYSTEM says *"No per-feature date formatters"*;
    `knowledge-v2/utils.ts › shortWhen` and `› longWhen` are exactly that, with live callers, and
    `src/shared/lib/format-time.ts` produces neither shape. Three more exist in mcp-connect and
    playground. → **Recommend promoting the two into `format-time.ts`** and deleting the three others.

35. **Do the info-column tab bodies need a loading state?** Four tabs render **nothing** while their
    reads are in flight; the `role="status"` strings are `sr-only`, so §1A is satisfied on both counts
    that matter. → **Recommend leaving them** — §1A's own "do not multiply ghosts" rule cuts against
    inventing four more in a 380px column. Recorded because it was raised.

36. **Does the `SECTIONS` literal in `template-picker.tsx › PickerBody` need a `sections` prop?** It
    hard-codes Private / Team / **Public** and is mounted inside link containers, where a container's
    `workspace` templates would group under "Public" instead of `lib/visibility.ts ›
    SECTIONS_CONTAINER`'s "Shared in this channel" — against §5A's *"never a literal here… never
    'Public'."* ⚠ **Mostly latent**: `filled.length > 1` suppresses headers and a post-2026-08-27
    container holds `workspace` rows only, so it surfaces **only** where a legacy `private` container
    row survives. → **Recommend a `sections` prop** (the editor already takes one) rather than a fix
    in the dark.

---

## 7. F-LEDGER actions

**Read first: the status convention is not the one the file documents.** The legend says *"Resolved
entries are deleted from this file"*; since ~2026-08-18 the practice is **resolved-in-place**, and
**58 resolved entries are kept**. Status must be read from three places — the heading marker, the
`Status:` line, and (for **32** entries) neither, because the newer prose format silently dropped the
template's field. **Two heading forms** (105 `###` / 122 `##`) mean a single-form grep under-counts by
roughly half. **227 live entries · 169 open** (2026-08-30), corroborated by
`node scripts/check-doc-refs.mjs`.

### 7.1 CLOSE THEM (19) — superseded, each with a one-line ledger edit already derived

`F-036` · `F-096` · `F-110` · `F-114` · `F-118` · `F-120` · `F-146` · `F-155` · `F-172` ·
`F-199` · `F-200` · `F-208` · `F-214` · `F-224` · `F-240` · `F-308` · `F-325`

⚠ **THE LIST WAS 19 AND IS 17 (verified entry by entry against the tree, 2026-08-30). TWO DO NOT
CLOSE, and both were wrong in the same way — the ledger read the entry rather than the code:**
- **`F-185` — NOT superseded; it GREW WORSE and moved to §7.2.** Its deferral trigger fired:
  `RESOURCE_TABLES` is polymorphic across FOUR tables now. (Its title count is stale the OTHER way —
  `workflows` is gone, so it is two other features' tables, not three.)
- **`F-203` — NOT superseded; still open, and now with evidence.** Neither branch of its demanded
  decision was taken (`dist` still tracked, no `.gitignore` entry, CI builds the packages but never
  diffs the rebuild), and a plain rebuild on 2026-08-30 rewrote three untouched modules — one of
  them shipping a REFUSAL that was in `src/` and not in the build the MCP server loads.

Three carry a caveat:
- **F-240 — superseded six weeks BEFORE it was filed.** `src/shared/lib/utils.ts › twMerge` is
  `extendTailwindMerge` with a `font-size` classGroup, landed 2026-07-07. **Residual to keep:**
  `text-stat` is absent from that classGroup and is live at `overview-bits.tsx`.
- **F-118 — close by deletion, but move two standing-knowledge blocks to `docs/ENGINEERING.md`
  first** (the zero-peer-bytes prefill; the `claude-cli://` 4096 / `claude://code/new` 1024 limits).
  Deleting the entry would delete knowledge that has no other home.
- **F-224 — class (e) shipped as a measured ratchet.** What stays open is the baselined debt,
  which is **F-337**, not this. ⚠ **"611" IS WRONG AND MATCHES NEITHER NUMBER IN THE FILE**
  (corrected 2026-08-30): `scripts/doc-refs-plain-path-baseline.json` records `count` **457**
  (and 457 `entries`) with **613** as `rawViolationsAtMeasurement`, `measuredAt 2026-08-26`.
  The baselined count is **457**.

### 7.2 GREW WORSE (24) — the wave made these bigger

`F-295` (3 → **6** consumers of the package copy; a confirm gate now branches on it) — ⚠ **RESOLVED
2026-08-30, the gate is `scripts/check-role-drift.ts › checkWorkspaceKind`** ·
`F-185` (**moved here from §7.1 on 2026-08-30** — its own deferral trigger *"revisit when a fourth
grantable resource type is added"* has FIRED: `teams/server/repository-resources.ts › RESOURCE_TABLES`
is polymorphic across four tables) · `F-318` (the rule now has **three** independent statements; the entry's explicit *"Do not
resolve it by wrapping the other call site too"* was answered with a fourth wrapper in a third tree) ·
`F-223` (6 tables + `home_scoped` all absent from the hand-maintained types) · `F-275` (20 → **254**
tracked cross-feature imports) · `F-327` (the multi-member migration **drops** the link-cap trigger, so
a stray channel is now inherited by an unbounded roster) · `F-299` (one claim now discloses **N**
emails, not one) · `F-105` (inheritance now dies at the *second thread ever created*) · `F-152` (the
ungated steer the entry warned about **shipped** — the echo brake was removed) · `F-197` (drainable
population widened to **guests**) · `F-093` / `F-226` / `F-282` (the at-exactly-500 cohort **10 → 12**
during the wave) · `F-055` · `F-108` · `F-112` · `F-144` · `F-178` · `F-204` · `F-213` · `F-216` ·
`F-304` · `F-305` · `F-328` · `F-334`.

### 7.3 CORRECTIONS OWED (4)

1. **F-345 — rewrite. Three separate errors, and one is load-bearing.**
   (a) 🔴 **It attributes the `bare` variant to the wrong module.** `members-v2/bits.tsx › IconButton`
   has **`onInvert`, not `bare`**; `bare` is `channels-v2/icon-button.tsx › IconButton`'s, and the
   `home.module.css` comment the entry cites as evidence names **channels-v2's**. **The entry's
   proposed settlement names the wrong promotion target** — a promotion following it as written would
   carry the wrong variant set. Fix this **before anyone acts on the settlement** (ASK-24).
   (b) Its claim that the copies *"are not byte-identical — the sizes and hover tints have already
   drifted"* is **false of the five it counts**: all five are one unique string. The real drift is
   against the wider family. This **narrows** the residual to a cheap mechanical promotion.
   (c) Its measurement command is **structurally blind to CSS-module copies of the same face** —
   `knowledge-v2.module.css › .treeActionBtn` and `› .cardStar` are the same bare face and survived a
   wave that converted the file next to them. Restate the residual as *"the bare icon-button FACE,
   however spelled"*, and give it a second command that catches module classes.
   ⚠ Also: the entry names `members-v2/bits.tsx › IconButton` as the seventh statement and **omits an
   eighth**, `channels-v2/icon-button.tsx › IconButton`, **whose own docblock names the convergence**.
   ⚠ And its disposition note (*"the playground panes are mock surfaces and can be left or deleted"*)
   contradicts `PUBLIC_ROUTES` and the live landing-hero link — see §9.2.

2. **F-317 — widen.** It knows only `link`; **five** roots are missing from `WEB_ONLY_ROOTS`
   (`link`, `c`, `authenticate`, `signup`, `get-started`). Record the subset assertion (G6) as the
   remedy.

3. **F-220 — mark STILL VALID, with the reason.** A first pass classified it superseded by resolving
   the filename against `apps/desktop-ui/src/pages/channels/channels-skeleton.tsx`, which the skeleton
   wave **did** rebuild. **The entry names the web tree's file**, and
   `src/features/channels/components/channels-skeleton.tsx` still composes both composites and
   `ChannelsV2Core` still paints it. **Two same-named files in two trees, one fixed, one not, is
   precisely the shape that makes an entry look closed to a reader who greps a basename.** Extend it
   to name the **double gate** (D11), which it does not currently describe.

4. **F-342 — record a FOURTH reader and narrow one leg.** The finding enumerates three unfiltered
   base-list readers; `channels-v2/composer-launch-panel.tsx` calls `useAgentTemplates` unfiltered too,
   added 2026-08-27 (the same day the shelf split shipped). The same answer applies (a container has no
   shelves), but the enumeration is one short. **Narrow the MCP leg:** *"MCP has no shelf concept"* is
   no longer true — `packages/mcp-server/src/tools/agent-ops-write.ts` has a full `ShelfArg` vocabulary
   and `› agent-ops-read.ts` takes a shelf; only the **read default** is unfiltered, which the finding
   calls right. And **mark the "no way to MOVE a base between shelves" half resolved-as-ruled**, not
   open — `agent-ops-write.ts` now refuses `shelf` on `op="update"` by name.

**Adjacent, still valid, re-verified verbatim and needing no edit:** F-330 (with D4 added as a
**second site**, not a new id), F-334, F-346, F-300 (⚠ one wording correction: the entry says *"a room
holding one channel and two people"*; the multi-member migration drops the cap, so the room is
**unbounded** — the fan-out arithmetic is unchanged), F-344, F-316 (scope correction only — see below).

### 7.4 DOC CORRECTIONS OWED

**`docs/DESIGN-SYSTEM.md` — four, all doc-side (`CLAUDE.md`: code > INVARIANTS > ENGINEERING):**
1. The colour table lists `bg-bg-inset` as `#eef1f5`. Both trees say **`#f1f1f1`**.
2. The `StandardDialog` row says *"New knowledge base, Add person … and New channel were standardised
   onto it."* True of `/home`'s dialog; **false of the one the workspace channels page mounts.** There
   are **two "New channel" dialogs on two recipes.**
3. **"Members … Settings" are listed under "Currently wired"** to the new kit. Measured 2026-08-30,
   neither uses **any** of the seven primitives that now define it — the six-path territory sweep
   returns **0 lines**.
4. The `SelectMenu` row says *"Two trigger faces"*; `src/shared/ui/select-menu.tsx › TRIGGER_FACE` has
   **three** (`flat`, `raised`, `raisedField`), minted by the 1.22.0 wave. **A doc defect the `/home`
   wave itself introduced.** The in-code rationale is already written; it never reached the doc.
   *(A fifth, folded into P4: the `.graph-node` row says *"only the Workflows cards are left"* —
   Workflows was deleted 2026-08-11 and the group has **zero** consumers, while the substrates it is
   grouped with have 13.)*

**`docs/INVARIANTS.md`:**
- 🔴 **§7's anchor is wrong and CI cannot see it.** It cites `ui-sync.js › SYNC_TABLES`; the
  definition is in `dopl-desktop-app/main/ui-sync-core.js › SYNC_TABLES` (split out at the 500-line cap
  2026-08-18). `ui-sync.js` re-exports it, so `check-doc-refs` resolves either way.
- **§5A and `template-picker.tsx`'s docblock both name `channels-v2/composer.tsx`'s Bot icon as a live
  picker mount.** That picker is **retired** — `composer.tsx` imports only `TemplateApprovalDialog`,
  and `composer-launch-panel.tsx`'s own docblock says so. The "two mounts share one cache entry"
  argument is **load-bearing for a state that no longer exists.**
- **§5 scopes the info-tab's dead buttons to "the channels page"**; that component has had **two
  hosts** since 2026-08-25. **Same correction owed on F-316's Location line.**
- **§8 should record that the rule's live enforcement is `/home` + channels only**, so the next person
  adding a field to a legacy payload knows they are the first.
- **§13 says "TWO crons" against three in `vercel.json`** (`oauth-cleanup`, `reconcile-seats`,
  **`playground-reaper`** — the last named nowhere and running unobserved since 2026-08-19, which also
  makes **F-133**'s job set wrong).
- 🔴 **A finding is used as a waiver for the rule it documents:** §509 cites F-275 to *authorize* a new
  cross-feature import while §483 cites §1 to *forbid* the import that would fix F-278. One doc, one
  file, both directions.
- **§4A** should name `POST /api/boot` (or the sweep should state its scope limit) and should settle
  ASK-19's guest-owns-container statement.

**`docs/MEMBERS-AUTHORIZATION.md`:** no guest column, no measurement date, last touched **6 days
before the guest role existed**. Add a Guest column (all ✖) + a date stamp; check the roster
`lastSeenAt` payload jointly.

**In-code doc corrections owed** (fold each into whichever change touches it):
`src/app/playground/page.tsx`'s *"No data fetching, no auth — every surface inside the mirror is
hardcoded"* (contradicted by the session POST, four `-live` polling modules and the shell's own
docblock one file over — **this is the doc that would let someone wrongly claim the marketing
exemption**); `src/shared/auth/public-routes.ts`'s *"subset of `PUBLIC_ROUTES`"* (`/api/playground` is
in `SELF_AUTH_ROUTES` and **not** in `PUBLIC_ROUTES`) and `src/proxy.ts`'s *"exactly
`SELF_AUTH_ROUTES`"* (the matcher excludes six of seven); `create-skill-dialog.tsx`'s *"same
ModalShell chrome as `CreateBaseDialog`"*; `knowledge-v2/landing-preview-core.tsx`'s *"its only caller
is …"* (there are **two**, and the second is precisely why `embedded` and `audienceFixed` exist);
`agent-templates/hooks/use-agent-templates.ts` and `› client/query-keys.ts` both saying *"if a `query`
variant is ever added"* while `shelf` **is** that variant 40 lines down; and
`base-settings-form.tsx`'s docblock listing six sections over seven rendered.

### 7.5 LEDGER HYGIENE (the structural backlog)

- **16 ids missing and mentioned nowhere: 029, 030, 031, 075, 077, 103, 242–249 (eight consecutive),
  348, 349.** ⚠ Written here **without the `F-` prefix on purpose** — with it, this file's own citation
  gate flags them as dangling, which is exactly the defect being reported. ⚠ **348 and 349 were
  allocated inside the wave under audit** (between 347 and 350, both 2026-08-28) and never filed. The
  findings header documents 160–162, 074 and 076 as gaps; these sixteen are undocumented.
- **The ledger's self-description is 19 ids out** (227 live vs 246 recorded in the header).
- **134 bare `path:LINE` citations** against `CLAUDE.md` standing rule 2. By contrast **zero
  `path › symbol` anchors in open findings fail to resolve.** *The symbol-anchor discipline works;
  the bare-path habit is the entire remaining exposure.*
- **A symbol that exists only in this ledger:** `SESSION_GATED_WORK_TOOLS` (F-078, F-080) — 3 hits
  repo-wide, all in the findings file, gone since `b579785b`. It is **load-bearing for a safety claim**
  that `dopl-desktop-app/main/session-profiles.js › buildSessionToolConfig` contradicts.
- **10 dangling Location lines naming deleted files with no successor stated** — F-017, F-058, F-098,
  F-115, F-145, F-155, F-116(b), F-214, F-229, F-341; 12 of the 15 unresolvable paths come from the
  single 2026-08-18 channels v1→v2 cutover.
- **Undated counts that have moved:** F-049 (35→76), F-108 (155→183), F-150, F-195, F-227, F-275,
  F-345, F-216.
- **`Status:` says closed while the body says open** — F-289, F-290. **Two stale "next free id"
  sentences survive** (F-189, F-193) inside the very header that warns against writing the number down.
  **F-064 prescribes copying a route deleted 2026-08-18.**
- **Entries verified against another entry, again** — the failure the file's own header says it keeps
  re-learning: F-146, F-106(a), F-109(a), F-296's "measured" half.
- **The 1.22.0 wave left four docblocks asserting a cap it deleted** — `workspaces/types.ts ›
  WorkspaceKind`, `src/features/home/server/service-writes.ts › mintContainerLink`,
  `apps/desktop-ui/src/pages/home/agent-panels.tsx`, `agent-templates/lib/visibility.ts ›
  SECTIONS_CONTAINER`.
- **Unverifiable halves** (production-only, per the file's own *"the database is the only witness"*
  doctrine): F-044, F-092 residual 1, F-133, F-169 (local migration files now **190** vs 157 recorded),
  F-190, F-192. **None is fully unverifiable** — each has a checkable code half.

---

## 8. Suggested wave sequencing

**Gates first.** Every one of §3 is an existing mechanism that was not extended; each costs less than
the port it protects, and without them §4 is re-audited in six weeks.

**Wave 0 — gates (§3).** G1 (shelf union, highest value) → G2 (permission modes) → G5 (F-295) →
G6 (deep-link subset, closes **D6**) → G3 (template caps) → G4 (plan strings, deletes the duplicate) →
G8 (sweep-list hardening) → G7 (token diff) → G9's doc half.

**Wave 1 — shared token/CSS layer.** One or two files each, no component churn, corrects the whole app.
1. **P1** — the dialog-footer rebuild. **Fixes every `ConfirmDialog` in the app** and is what makes
   Wave 4 cheap.
2. **P2** — `.lightScope` + `.brandPill` + the two black-CTA forks; the Stripe `#646d78` in the same
   change.
3. **P3** — the five off-scale/hardcoded values in the two CSS modules.
4. **§7.4's DESIGN-SYSTEM ×4** — fix them here, or the doc wins the next argument.
5. **P4** — the dead CSS group (⚠ keep both substrates) and the four dead tokens; §4.7's four stale
   retired-era comments.

**Wave 2 — logic bugs.** Small, high-consequence, independent of the design work.
6. **D1 + D2** — `useWorkspaceEntitlements`: return `isError`, consume `degraded`, per-key
   `?? EMPTY_X`; **then** the overview reads. **One hook fixes two surfaces.**
7. **D3 + P15** — the star toggle, both trees, with the key-DELETED fixture.
8. **D8 + P16** — the roster guard and the three guest-blind sites (scope depends on ASK-1).
9. **P12** — gate the upsell card. **P17** — the role-blind settings nav.
10. **D13 + P18** — the `/api/workspaces/me` lock and the `/api/oauth` prefix, **with the executable
    pin** in each case. Security-adjacent; do them together.
11. **P19** — the hand-typed cache key and the missing `coldKeys`. **D14** — the smoke label.

**Wave 3 — accessibility + loading.**
12. **D7** — `ConnectAgentBanner` + `WelcomePopup` onto `ModalShell`. **The only defects in the audit
    that are not cosmetic.**
13. **P6 + P7** — the shared `SkeletonSurface` promotion (ASK-9 first). Closes F-318, the four
    call-site wrappers, the billing gap and the guest ghost in one move.
14. **D11** — the channels double-skeleton, via a `loadingSkeleton` slot.
15. **P8 + P10 + P11** — the four hand-rolled pulses, the `ROW_GRID` mismatch, the text loader.
16. **P13 + P14** — the keyboard-inert tree rows and the in-place cache sorts.
17. **P9** — geometry by reference, **and the pin that would have caught it**.

**Wave 4 — chrome, largest first.**
18. §4.2 dialogs in order: `create-channel-dialog` → `create-workspace-dialog-core` →
    `invite-dialog` (role menu + email field) → `DiffModal` (ASK-32 first) → `launch-sheet` →
    `create-skill-dialog` → the three remaining → `base-settings-form`.
19. The `OpenScaleButton` batches: members (18) · billing (15) · skills+ontology (14, ⚠ ASK-20 for
    ontology, ⚠ the `nowrap` caveat on `SkillFolderControl`) · `ICON_BTN` ×5 (⚠ §9.2) ·
    `overview-header` · `PageError`.
20. `SectionPanel` conversions: billing's six · overview's `PeriodStats` · the three danger zones onto
    `SectionBox`.
21. mcp-connect end to end · playground and ontology token bypasses · `ChipMultiSelect` · the
    `bg-white/25` divider · the row-geometry promotion.
22. Copy: the minimal-copy deletions · the payment-in-your-browser consolidation ·
    **terms/privacy** (⚠ external auditors read these — do not defer past Wave 4).
23. §4.7's dead exports, triplicated scope labels, duplicated delete flow and dead fixture typing.

**Wave 5 — realtime.** §4.4's three PORTs (`SYNC_TABLES` 17 → 5), gated on ASK-10 for knowledge.
Sequence it last: it is the only wave whose payoff is measured in the database rather than on screen,
and `ui-sync-tables.test.mjs` pins both directions, so it is a single coordinated release.

**Blocking ASKs, in the order they block work:** ASK-1 (blocks D8/P10 scope) → ASK-9 (blocks P6/P7) →
ASK-2 (blocks P17; ASK-18 is the same family) → ASK-32 (blocks the `DiffModal` port) → ASK-24 with
F-345's correction (blocks the icon-button batch) → ASK-13 (blocks `base-settings-form`) →
ASK-10 (blocks Wave 5) → ASK-4 (decides whether the upgrade modal is in scope at all).

---

## 9. Where the auditors disagreed

Recorded rather than resolved, because each is a judgment Samuel may want to make.

1. **Overview's §8 severity.** The core-pages audit calls it *"the highest-severity logic finding in
   the report"* — five reads that throw on a key-absent cached entry, on an IndexedDB-persisted cache
   with a 24h `gcTime`. The stale-cache axis calls the overview payload fields **safe by
   construction**, because the route path changed in the same commit that added them, so **no stale
   entry can exist**. **Both are right about different things:** the *fields* are safe today; the
   *shape* is unguarded, and the entitlements half of the same gate (`credits.limit`) is genuinely
   exposed because that hook is shared with billing. → **Treated here as D2 at reduced urgency for the
   overview half and full urgency for the entitlements half.**

2. **Is `src/features/playground/**` a mock tree?** The cross-cutting audit calls it *"a mock/demo
   tree, not a shipped surface"* and LEAVEs its three `ICON_BTN` copies, its 6 `btn-light` sites and
   its `SectionBox` uses on that basis — and **F-345's own disposition note says the same**. The
   legacy-surface audit shows it is **public, linked and live-polling**: `/playground` is in
   `PUBLIC_ROUTES`, `/api/playground` is in `SELF_AUTH_ROUTES`,
   `src/features/marketing/components/connect-section.tsx` links *"Try in playground"* from the landing
   hero, `/api/playground/session` provisions a guest bearer, four `-live` modules poll a real guest
   workspace, and `/api/cron/playground-reaper` reaps the sessions. → **The legacy reading has the
   receipts; the exemption people assume it has does not exist.** F-345's disposition note needs the
   same correction (§7.3).

3. **Is F-345's count a ledger defect?** Core-pages says the recorded "six" is now five and the finding
   should be updated. Cross-cutting corrects its own first reading: **F-345's title already says
   "FIVE more places"**, so the finding is accurate and it is only DESIGN-SYSTEM's prose that carries
   the historical six (which counts the one that was consumed) — *"not a ledger defect, just a sentence
   that reads as a live count and is not one."* → **The cross-cutting reading is the correct one on the
   count.** F-345 still needs the three corrections in §7.3, none of which is about the number.

4. **Is `launch-sheet.tsx` in the `StandardDialog` contract's scope?** The knowledge/agents audit calls
   the conversion mechanical and lists it as a PORT (it already imports `Field` and `RAISED_INPUT`).
   The cross-cutting audit files it as an **ASK** with the other picker/sheet shapes, on the grounds
   that a sheet is not a create/edit dialog. → **Recorded as a PORT gated on ASK-13.**

5. **Two auditors independently mis-resolved a basename before catching themselves** — F-220 (web tree
   vs desktop tree) and the launch-sheet concave claim (`agent-templates` vs `channels`). **Both
   corrections are in this file, and both are the report's own thesis biting.** Treat any
   same-named-file-in-two-trees claim as unverified until the tree is named.
