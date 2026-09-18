# 08 — THE SLOT-REPLACING-HOST AUDIT

**Wave 0d. It gated Wave 1.** Measured 2026-09-17 against `master` at `cf87e6f6`, worktree
`wave0/slot-audit`. **Read-only: this audit changed no source.**

> 🟢 **EXECUTED 2026-09-17 — WAVE 1A (branch `wave1/one-record-surface`) CLOSED THE TOP THREE AND
> THE R1 BODY WITH THEM: §5 orders 1, 2, 3 AND 4 ARE DONE.** F1 (`ChannelsOverlays` renders
> `SurfaceAgentView`) · F3 + the `viewerUserId` defect, filed and fixed as **F-723** · F2
> (`activity` onto the context; the wrapper deleted) · R1 proper (`infoTab` DELETED, `infoExtras`
> in its place, `person-info-tab.tsx` absorbed). **Order 5 (X4) had already landed in wave 1B;
> order 6 (F6, the skeleton) is NOT done — 00-MASTER.md §5 wave 1 row 6 carries the measurement
> that says why.** ⚠ **A SIXTH FORK THIS AUDIT DID NOT COUNT turned up during the execution and is
> also gone: `src/features/marketing/components/banner-demo/demo-info-tab.tsx`**, the hero scene's
> own copy of the same ladder, injected through the same slot. §1's derivation command sweeps
> `src/features/` and would have found it; the audit's slotless-fork table was built from the
> CHANNEL surface's hosts and the marketing tree was not read as one. **Re-run §1's command rather
> than trusting the 84.**
> ⚠ **TWO DEVIATIONS FROM §6, BOTH DELIBERATE, BOTH ARGUED IN THE COMMITS:**
> (1) **`mentionsLayout` IS A CAPABILITY, NOT A `ChannelInfoTabContext` FIELD.** §6.1 lists it on
> the context, which carries what the SURFACE hands the HOST; which mentions face to draw is a
> decision the HOST hands the SURFACE, so it sits on `ChannelSurfaceCapabilities` with the other
> three host knobs. (2) **`ChannelInfoExtras` DECLARES ONLY `belowRoster`.** §6.2's `belowCard` was
> for /home's curated `info_card` rows, and **R-19 (wave 1B) put those rows in the shared body on
> every host** — so the region has no consumer, and INVARIANTS §15 says an unreachable one is
> deleted rather than declared. A second region is a one-line addition the day a host needs it.
> ⚠ **`headerEditable` (§6.1) WAS NOT ADDED EITHER.** Its stated reason was that the rule was
> spelled twice; the second spelling was `person-info-tab.tsx`'s and died with the file.

The rule it enforces is `docs/INVARIANTS.md`'s, restated in `06-rulings-archive.md` § *The one hazard
this archive exists to prevent*:

> a host that **replaces a slot's body** silently loses a capability the shared component is already
> minting.

and in `00-MASTER.md` §4.2 **G2**: *a slot may ADD, never REPLACE.* Three capabilities have been lost
this way in three weeks — `mentions` (2026-09-15), `headerEdit` (2026-09-17), and the activity strip,
which is **still lost today**. This file walks every slot in the tree and says which ones can do it
again.

**The answer up front: the class is ONE slot.** Of 78 declared slots, 10 replace a body and 9 of
those replace a body that mints nothing. `ChannelSurfaceSlots.infoTab` is the whole hazard — and it
is currently dropping **five** minted facts, one of which is a live wrong answer on screen.

---

## 1. Method, and what "a slot site" means here

A **slot site** is a declared prop on a component under `src/shared/`, `src/features/` or
`apps/desktop-ui/src/` whose type is `ReactNode` / `ReactElement` or a function returning one,
**excluding plain `children`** (which is composition, not a slot). Re-derive the set with:

```sh
grep -rn "ReactNode\|ReactElement" src/shared src/features apps/desktop-ui/src \
  --include='*.tsx' --include='*.ts' | grep -v "\.test\." \
  | grep -E "^\S+:[0-9]+:\s+(readonly )?[a-zA-Z]+\??:" \
  | grep -viE "^\S+:[0-9]+:\s+(readonly )?children"
```

**78 sites, 2026-09-17.** The `slots.` / `slots?.` object idiom itself has exactly ONE non-test
occurrence in the tree (`grep -rn "slots\.\|slots?\." src apps/desktop-ui/src | grep -v data-slot`) —
`surface-info-panel.tsx › SurfaceInfoPanel`. Every other slot is a plain named prop.

Beside those, **6 SLOTLESS FORKS** — a host that re-implemented a shared body instead of filling a
slot, or a shared leaf hand-wired twice. They are the same defect wearing no slot, so they are
audited here too. **84 sites examined.**

Each site was classified on two independent axes, because they are different questions:

| Axis | Values | The question |
|---|---|---|
| **Shape** | REPLACING / ADDITIVE | does the host's node stand *where a body would otherwise render*, or *beside* one? |
| **Cost** | capability-losing / capability-free | does the shared component **mint** anything (a gate, a read, a derivation, a permission) that the replacement cannot see? |

**A replacing slot is only a hazard when it is also capability-losing.** A skeleton slot replaces a
body and mints nothing; `infoTab` replaces a body the surface paid for.

---

## 2. The count

| | Count | Of which capability-losing |
|---|---|---|
| **REPLACING** slots | 10 | **1** |
| **ADDITIVE** slots | 68 | 0 |
| **Slotless forks** (no slot, host re-implemented) | 6 | **4** |
| **Total sites audited** | **84** | **5** |

---

## 3. The table — every REPLACING slot

`⛔` = capability-losing, the Wave 1 class. `✔` = replacing but capability-free, leave alone.

| # | Shared component | The slot | What it replaces | Host(s) | Minted-and-discarded | Verdict |
|---|---|---|---|---|---|---|
| R1 ✅ | **FIXED — wave 1A.** `src/features/channels/components/channel-surface-contract.ts › ChannelSurfaceSlots` → `src/features/channels/components/info-panel.tsx › infoTab` | `infoTab?: (ctx: ChannelInfoTabContext) => ReactNode` | nothing any more: the slot is `infoExtras`, a record of NAMED REGIONS | `apps/desktop-ui/src/pages/home/relationship-record.tsx` → `apps/desktop-ui/src/pages/home/person-roster-actions.tsx` (the `belowRoster` region) | none — the body is unconditional | **DONE 2026-09-17** |
| R2 ✔ | `src/shared/ui/skeleton.tsx › TwoPaneListSkeleton` | `detail` | `DetailDocSkeleton` | `src/features/channels/components/channels-skeleton.tsx › ChannelsSkeleton` | nothing — a ghost mints no data | keep |
| R3 ✔ | `apps/desktop-ui/src/components/skeletons/shell-skeleton.tsx › ShellChromeSkeleton` | `rail` | `AccountRailSkeleton` | `apps/desktop-ui/src/components/app-shell/app-shell.tsx` | nothing; the replacement is *richer* (live rail over ghost), which is the shape a good replacing slot has | keep |
| R4 ✔ | `src/features/agent-templates/components/agent-templates-core.tsx` | `loadingSkeleton` | `PageShellSkeleton` | `apps/desktop-ui/src/pages/agents/index.tsx` | nothing | keep — `docs/INVARIANTS.md` already rules this idiom sound |
| R5 ✔ | `src/features/members/components/members-v2/members-v2-view.tsx › MembersV2View` | `loadingSkeleton` | the shared ghost | `apps/desktop-ui/src/pages/members/index.tsx` | nothing | keep |
| R6 ✔ | `src/features/channels/components/threads-tab.tsx › ThreadsTab` | `artifacts` | the thread list, when `artifactsFace` | `src/features/channels/components/info-panel.tsx` (intra-tree) | nothing — the shared component owns the toggle and both faces | keep |
| R7 ⛔ | `src/features/onboarding/components/welcome-popup.tsx` | `brand` | the default mark | onboarding bindings | nothing — decorative | **MOOT — the file is deleted (R-49, 2026-09-17)** |
| R8 ✔ | `src/shared/ui/scope-share-popover.tsx` | `locked` (`locked ? locked.note : children(close)`) | the popover body | knowledge / ontology share surfaces | the `close` callback — which a locked body has no action to close with | keep |
| R9 ✔ | `apps/desktop-ui/src/routes.tsx` | `element` | `PlaceholderPage` | the route table | nothing — routing, not composition | keep |
| R10 ⚠ | `src/features/ontology/components/board-header-bits.tsx › BoardSettingsMenu` | `hostRows` **+** the `onDelete` convention | *one row*, by convention: *"A host that brings its own Delete … passes it in `hostRows` and no `onDelete`"* | `src/features/ontology/components/ontology-view.tsx › settingsMenu` ← `apps/desktop-ui/src/pages/home/ontology-panels.tsx` | nothing minted; but the mutual exclusion is **prose, not a type** | keep, add the type fence (§6.5) |

**R10 is the only near-miss in the additive set** and it is worth naming: the menu is additive in
every mechanical sense (`hostRows` adds rows, `Rename` survives), and the one replacement — Delete —
is enforced by a docblock asking the caller to omit a prop. Nothing fails if a host passes both. It
is a two-line type change (§6.5), not a Wave 1 item.

### The slotless forks

| # | Shared body | The fork | Minted-and-discarded | Verdict |
|---|---|---|---|---|
| F1 ✅ | `src/features/channels/components/surface-agent-view.tsx › SurfaceAgentView` (the ONE agent-pane wiring) | `src/features/channels/components/overlays.tsx › ChannelsOverlays` hand-wires `ChannelsAgentPanel` itself | `color` (off `channel-surface-data.ts › liveAgents`, the server's per-member assignment — **a shipped 2026-09-13 ruling the workspace page has never rendered**) and `full` | **DONE 2026-09-17** — `overlays.tsx` renders `SurfaceAgentView`; eight forwarded props deleted; pinned by `src/features/channels/components/channels-core-agent-color.test.tsx` |
| F2 ✅ | `src/features/channels/components/info-tab.tsx › InfoTab`'s activity section | `apps/desktop-ui/src/pages/home/person-thread-activity.tsx › PersonThreadActivity` | `channel-surface-data.ts › activityBins` / `activityLoading` — the surface has **already** mounted `useOverviewSeries` on the identical key | **DONE 2026-09-17** — on the context as `activity`; the wrapper deleted (63 lines) |
| F3 ✅ | `src/features/channels/components/info-tab.tsx › InfoTab`'s Members section | `apps/desktop-ui/src/pages/home/person-members.tsx › PersonMembers` | `channel-surface-data.ts › members`, **and `AuthorIndex.currentUserId`** — see §4.3, this one is on screen | **DONE 2026-09-17** — `members` + `index` on the context; **F-723** filed and fixed; pinned by `apps/desktop-ui/src/pages/home/home-roster-presence.test.tsx` |
| F4 ⛔ | `src/features/channels/components/agent-panel.tsx › AgentStats` | `src/features/channels/components/agent-window.tsx › AgentWindowStats` — two fills of ONE additive `stats` slot | nothing minted; the two bodies differ only by the `Started …` fragment and have already drifted on `className` | Wave 2 (P17) |
| F5 | `apps/desktop-ui/src/components/skeletons/shell-skeleton.tsx › ShellChromeSkeleton` | `apps/desktop-ui/src/pages/home/home-skeleton.tsx` — a second frame ghost, though R3's `rail` slot exists | nothing | Wave 6 (per `00-MASTER.md` §4.4) |
| F6 | none yet — the promotion target is `src/features/channels/components/`, beside `channel-surface-standalone.tsx` | three channel ghosts: `apps/desktop-ui/src/pages/home/channel-record-skeleton.tsx`, `src/features/channels/components/channels-skeleton.tsx`, the kit generics in `src/app/c/[workspaceId]/guest-channel.tsx` | nothing | Wave 1 item 6 (P10 + X8) |

---

## 4. R1, feature by feature — what `PersonInfoTab` discards

### 4.1 What the surface MINTS, and what the context carries

`src/features/channels/components/surface-info-panel.tsx › SurfaceInfoPanel` hands the **default**
`InfoTab` eleven facts. `ChannelInfoTabContext` carries **three**.

| Minted by the surface | On `ChannelInfoTabContext`? | What /home does instead |
|---|---|---|
| `gate` (the ONE `useRefetchGate`) | ✔ since 2026-08-25 | uses it |
| `headerEdit` (write + mirrored `canManageChannel`) | ✔ since 2026-09-17 | uses it |
| `mentions` bundle (page, order, `onOpen`, `onMarkAllRead`) | ✔ since 2026-09-15 | uses it |
| **`channelName`** — the derived display name `peerNamedHeader` decided | ✘ | re-derives: `apps/desktop-ui/src/pages/home/home-rows.ts › channelTitle` |
| **`members`** — `channel-surface-data.ts › useChannelMembers` | ✘ | mounts it **twice more** (`person-info-tab.tsx`, `person-members.tsx`) |
| **`index`** (`AuthorIndex`, carrying `currentUserId`) | ✘ | **never resolves the viewer — §4.3** |
| **`activityBins` / `activityLoading`** | ✘ | mounts a **second** `useOverviewSeries` in `person-thread-activity.tsx` |
| **`threads` / `threadCount`** | ✘ | renders no Threads row at all |
| `channel` (the resolved row) | ✘ (an adapter prop today) | the host passes its own — correct, it is a host fact |

⚠ **`00-MASTER.md` §4.2's context block lists `activity` as an addition still owed, and the Wave-0d
brief's shorthand "partly fixed via headerEdit / mentions / activityBins" is wrong on the third
name.** Verified at `cf87e6f6`: `ChannelInfoTabContext` has exactly `gate`, `mentions`, `headerEdit`.
Activity is **not** on it. `00-MASTER.md` is right; the shorthand is not.

### 4.2 Body diff — `InfoTab` vs `PersonInfoTab`

`src/features/channels/components/info-tab.tsx › InfoTab` (288 lines) vs
`apps/desktop-ui/src/pages/home/person-info-tab.tsx › PersonInfoTab` (395 lines).

| Section | Shared body | /home's replacement | Same? |
|---|---|---|---|
| "Channel info" heading | ✔ | ✔ | identical string, two calls |
| Name row (`Type`, `InlineEditText`, 120 cap, empty = cancel) | ✔ | ✔ | semantically identical, **forked markup**; read face `channelName` vs `channelTitle` |
| Description row (`AlignLeft`, 2000 cap, `"None"`, `text-text-muted`) | ✔ | ✔ | semantically identical, **forked markup** |
| `headerEditable` (`canEdit && !channel.isDirect`) | ✔ | ✔ | same expression, **two declarations** |
| Creator row | ✔ (from prop `members`) | ✔ (from its own hook) | same markup, different source |
| Created row | "Date of creation" · `formatShortDate` · `channel.createdAt` | "Created" · `formatDate` · `homeChannel.createdAt` | ✘ **three-way divergence: label, formatter, source row** |
| **Status row** (`CircleDot`, Archived / `StatusPill`) | ✔ | — | ✘ **LOST** |
| Mentions | `MentionsDisclosure`, collapsed, badge | `MentionsList` top-level, open, `inset="flush"` | ✘ in kind — **ruled** (Samuel 2026-09-17) |
| **Threads count row** (`ListChecks`) | ✔ | — | ✘ **LOST** (`threadCount` is not on the context) |
| Linked threads (`HARDCODED_LINKED_THREADS`) | ✔ | — | ✘ LOST, and **dead** — delete rather than port (X7) |
| Activity strip | from props, no read | own hook (`PersonThreadActivity`) | ✘ **duplicated body, one cache key** |
| Members heading | count + `Add member` + `Filter members` `IconButton`s | count only | ✘ — /home is **right**; the two buttons have no `onClick` (R-46) |
| `MemberRoster` | `emptyLine`, **`viewerUserId={index.currentUserId}`** | no `emptyLine`, **no `viewerUserId`** | ✘ `emptyLine` ruled; **`viewerUserId` is a defect — §4.3** |
| Curated `info_card` rows | — | ✔ (`InfoCardSection`, custom rows, remove) | ✘ **/home only — genuine extra** |
| Add person / Link out | — | ✔ (`PersonMembers`) | ✘ **/home only — genuine extra** |

**Nine rows are the same rows. Three are losses. Two are genuine host extras. One is ruled
different.** That is the whole case for `infoExtras`: the slot's SHAPE is right and its SIZE is
wrong.

### 4.3 The live defect this audit found

> `apps/desktop-ui/src/pages/home/person-members.tsx › PersonMembers` renders
> `<MemberRoster members={members} />` with **no `viewerUserId`**.

`src/features/channels/components/member-roster.tsx › MemberRoster` feeds that prop to
`src/features/channels/components/view-model.ts › isPresentForViewer`, whose whole job is:

```ts
if (viewerUserId && member.userId === viewerUserId && isSpaRenderer()) return true;
return isPresent(member, now);   // the lastSeenAt heartbeat
```

The shared Info tab passes `index.currentUserId` and gets the override. /home's replacement passes
nothing, so it falls through to the heartbeat — **in the desktop renderer, which is the only place
`isSpaRenderer()` is ever true.** The operator can therefore read as OFFLINE in their own home
channel while the workspace channels page, on the same machine in the same second, shows them
online.

**This is exactly the failure mode the rule predicts, a fourth time**, and it was on screen until
wave 1A. ✅ **FILED AND FIXED AS `F-723` (2026-09-17)**, in the change that fixed it — **allocate by re-deriving the highest claimed across
every live branch, never from `master`'s** (CLAUDE.md; `master`'s highest is **F-717** as of
2026-09-17, and this branch deliberately claims none, because a doc-only branch minting an id is how
three branches once produced six entries under three ids).

---

## 5. Ranked fix order for Wave 1

Ranked by **how much each discards**, which is also very nearly `00-MASTER.md` §5's order — the two
agree, and where they differ the note says so.

| Order | Instance | Discards | Master's item | Why here |
|---|---|---|---|---|
| **1** | **F1** — `ChannelsOverlays` renders `SurfaceAgentView` | a shipped colour ruling, on the workspace page, today | P2 + P1 | Smallest blast radius of anything in the wave: one import, ~14 forwarded props deleted, no shared body changes shape. It closes a live visible drift **as a side effect rather than as a patch**, which is the whole argument for collapsing rather than fixing in place. |
| **2** | **F3 + the `viewerUserId` defect** — `members` **and `index`** onto `ChannelInfoTabContext` | `data.members` (×2 duplicate hooks) + the viewer id → a wrong presence answer on screen | P9 (+ `headerEditable`) | ⚠ **MOVED UP one place from `00-MASTER.md` §5, which runs P8 before P9.** Both are one-field context additions and neither blocks the other, but **only this one fixes a wrong answer a user can see**. If the wave is cut short, this must already be in. |
| **3** | **F2** — `activity` onto the context; delete `person-thread-activity.tsx` | `data.activityBins` / `activityLoading` (a second `useOverviewSeries` on one key) | P8 + X6 + X7 | The context pattern's fourth application, and the last of the three capabilities the archive names. Re-derive `HARDCODED_THREAD_ACTIVITY`'s remaining users before X7. |
| **4** | **R1 proper** — one `info-tab.tsx` with `mentionsLayout` + `infoExtras`; delete `person-info-tab.tsx` | the Status row, the Threads row, `channelName`, and both forked markup ladders | P7 + P6 + X5 | Has to come **after** 2 and 3: the one body can only be written once the context can feed it. Lands R-19 · R-20 · R-21 · R-22 · R-45 · R-46 here. |
| **5** | **X4** — delete the `knowledge` capability, tab, width branch and `channelPaneTabs` arm | — | X4 (R-18) | ⚠ **Verified dead at `cf87e6f6`: ZERO hosts pass it.** `grep -rn "knowledge:" apps/desktop-ui/src src/app --include='*.tsx'` returns one COMMENT in `relationship-record.tsx` and no code. It changes the tab SET, so it must land with the body. |
| **6** | **F6** — `ChannelRecordSkeleton` into `src/features/channels/components/`; GUEST adopts it | — | P10 + X8 | Unchanged from master. Gated on R-43's ASK-9 arm, which is **Wave 0's** ruling, not this wave's. |
| — | **F4** (one `AgentStats`), **F5** (one frame ghost), **R10** (the `hostRows` type fence) | — | P17 / Wave 6 / §6.5 | Out of Wave 1. None is capability-losing. |

---

## 6. The exact contract additions

### 6.1 `ChannelInfoTabContext` — the target shape

Declared in `src/features/channels/components/channel-surface.tsx`, minted in
`src/features/channels/components/surface-info-panel.tsx › SurfaceInfoPanel`.

```ts
export interface ChannelInfoTabContext {
  // ── ALREADY THERE
  gate: MutationGate;                       // 2026-08-25
  mentions: MentionsBundle;                 // 2026-09-15  ← added after a slot dropped it
  headerEdit: ChannelHeaderEdit;            // 2026-09-17  ← added after a slot dropped it

  // ── ADD IN WAVE 1, STEP 2 (order 2 above)
  /**
   * THIS SURFACE'S ROSTER, ALREADY READ (`channel-surface-data.ts › members`).
   * ⚠ A TAB MAY NOT MOUNT ITS OWN: two `useChannelMembers` on one key are two
   * subscribers to one entry and two sources of truth for one list.
   */
  members: ChannelMember[];
  /**
   * THE AUTHOR INDEX, WHICH CARRIES THE VIEWER (`index.currentUserId`).
   * 🔒 IT IS NOT A CONVENIENCE. `member-roster.tsx › MemberRoster` feeds it to
   * `view-model.ts › isPresentForViewer`, whose desktop override only fires when
   * the viewer is known — a roster rendered without it reports the OPERATOR
   * offline in their own channel.
   */
  index: AuthorIndex;
  /** The host-decided rule, in ONE place, not two (`info-tab.tsx › headerEditable`
   *  and `person-info-tab.tsx › headerEditable` are the same expression today). */
  headerEditable: boolean;

  // ── ADD IN WAVE 1, STEP 3 (order 3 above)
  /** Already read by the surface. A tab that re-reads pays the key twice. */
  activity: { bins: readonly ActivityBin[]; loading: boolean };

  // ── ADD IN WAVE 1, STEP 4 (order 4 above) — host facts the ONE body needs
  /** The DERIVED display name `peerNamedHeader` settled, upstream. */
  channelName: string;
  /** Off the same bounded list the Threads tab renders. */
  threadCount: number;
  /** The ONE ruled presentational difference (Samuel, 2026-09-17). */
  mentionsLayout: "disclosure" | "category";
}
```

### 6.2 `ChannelSurfaceSlots` — additive by type, not by docblock

```ts
export interface ChannelSurfaceSlots {
  /**
   * ⚠ REGIONS, NEVER A BODY. The return type cannot be a `ReactNode`, because a
   * `ReactNode` is exactly what a body is — the named keys are the fence.
   */
  infoExtras?: (ctx: ChannelInfoTabContext) => {
    /** /home: the curated `info_card` rows (`info-card-rows.tsx`). */
    belowCard?: ReactNode;
    /** /home: Add person / Link out (`person-members.tsx`'s tail, `link-out-panel.tsx`). */
    belowRoster?: ReactNode;
  };
  // ⚠ `infoTab` IS DELETED, not deprecated. A body-replacing slot left in the
  // type is a body-replacing slot a later host will reach for.
}
```

`src/features/channels/components/info-panel.tsx`'s `infoTab?: ReactNode` prop goes with it, and the
`infoTab !== undefined ? infoTab : <InfoTab …/>` branch becomes an unconditional `<InfoTab …/>`.

### 6.3 F1 — the agent wiring

No new contract. `src/features/channels/components/overlays.tsx › ChannelsOverlays` renders
`<SurfaceAgentView data={data} openAgent={…} onClose={…} currentUserId={…} workspaceSlug={…} />`
beside `ChannelsCreateDialogs`, and **the two mount positions stay** — WS must mount outside the
`channel ? …` arm so a workspace with no channel can still create one. `ChannelsOverlays` loses
`openAgent`, `agentSessions`, `messages`, `pendingPosts`, `onPostPending`, `onAnswerEscalation`,
`answerBusy`, `postBusy`, `onRefreshSessions` from its signature and gains `data`.

### 6.4 F2 / F3 — the deletions the context enables

- `apps/desktop-ui/src/pages/home/person-thread-activity.tsx` — **delete** (63 lines). The strip is
  `info-tab.tsx`'s, fed from `ctx.activity`.
- `apps/desktop-ui/src/pages/home/person-members.tsx` — **keep the Add person / Link out tail as
  `belowRoster` content; delete its `PanelHeading` + `MemberRoster` + `useChannelMembers`.** The
  roster is the shared body's, fed from `ctx.members` + `ctx.index`. This is where the presence
  defect dies.
- `apps/desktop-ui/src/pages/home/person-info-tab.tsx` — **delete** (395 lines). Its curated-card
  block becomes `belowCard`.

### 6.5 R10 — the `hostRows` type fence (not Wave 1)

`src/features/ontology/components/board-header-bits.tsx › BoardSettingsMenu` asks callers in prose to
omit `onDelete` when they pass `hostRows`. Make the type say it:

```ts
type BoardSettingsMenuProps = { clusterName: string; onRename?: () => void } & (
  | { hostRows: (close: () => void) => ReactNode; onDelete?: never }
  | { hostRows?: never; onDelete?: () => void }
);
```

---

## 7. The tests that pin "additive only"

Four layers. The first is the one that would have caught all four historical misses.

### 7.1 THE PARITY TEST — render each host against the shared body's fixture

**One test, one fixture, every host.** The shared body's own fixture is mounted through each host's
composition and asserted to still say every shared capability. It is the direct executable form of
*"a host may add, never replace"*.

```
src/features/channels/components/info-tab-parity.test.tsx   (new, shared tree)
```

```ts
// ⚠ THE FIXTURE IS THE SHARED BODY'S, and every host is mounted against THE SAME ONE.
// A host-local fixture is how a host comes to be tested against the thing it renders
// rather than against the thing it is supposed to render.
const SHARED_CAPABILITIES = [
  { name: "the name row, editable",   find: (s) => s.getByLabelText("Channel name") },
  { name: "the description row",      find: (s) => s.getByLabelText("Channel description") },
  { name: "the creator row",          find: (s) => s.getByText("Creator") },
  { name: "the created row",          find: (s) => s.getByText(/Created|Date of creation/) },
  { name: "the status row",           find: (s) => s.getByText(/Active|Archived/) },     // R1's loss
  { name: "the threads count",        find: (s) => s.getByText("Threads") },             // R1's loss
  { name: "the mentions list",        find: (s) => s.getByTestId("mentions-list") },     // 2026-09-15's loss
  { name: "the activity strip",       find: (s) => s.getByTestId("thread-activity") },   // today's loss
  { name: "the members roster",       find: (s) => s.getByTestId("channel-members") },
] as const;

describe.each(HOSTS)("the Info body, per host: %s", (host) => {
  it.each(SHARED_CAPABILITIES)("still renders $name", async ({ find }) => {
    expect(find(await mountHost(host, SHARED_FIXTURE))).toBeTruthy();
  });
});
```

`HOSTS` = WS (`channels-core.tsx`), HOME (`relationship-record.tsx`), GUEST
(`src/app/c/[workspaceId]/guest-channel.tsx`), POP-OUT. **Adding a host to the array is the whole
cost of adding a host**, which is the property that makes this survive Wave 1.

### 7.2 THE MINT TEST — nothing minted may be re-minted downstream

A hook-call census, asserted at the surface. It catches the *cause* rather than the symptom, and it
is the only test that fires on the day a host adds a second read rather than weeks later when the two
disagree.

```ts
it("mounts ONE roster read and ONE activity read for the whole surface", () => {
  mountHome();
  expect(useChannelMembers).toHaveBeenCalledTimes(1);   // 3 today
  expect(useOverviewSeries).toHaveBeenCalledTimes(1);   // 2 today
});
```

### 7.3 THE CONTEXT-IDENTITY TESTS — extend the one that already exists

`src/features/channels/components/channel-surface.test.tsx` already pins *"hands the Info-tab slot
the surface's own refetch gate"* **by identity, not by shape** — `expect(seen).toBe(fromLive)`. That
is the right assertion and it generalises: every new context field gets the same one-liner, because a
shape assertion passes against a value the tab minted for itself, which is precisely the bug.

⚠ **Two tests in that file INVERT in Wave 1 and must be rewritten, not deleted:**
`"REPLACES the Info tab's body with the slot, keeping the tab row"` (which asserts
`queryByText("Channel info")` is **null** — the exact opposite of the target rule) and
`"renders the channels page's own Info tab when no slot is given"` (which becomes unconditional).

### 7.4 THE PRESENCE REGRESSION — `viewerUserId` reaches every roster

```ts
it("reports the viewer online in a home channel while the desktop renderer is running", () => {
  mockIsSpaRenderer(true);
  mountHome({ members: [me({ lastSeenAt: null })] });
  expect(within(screen.getByTestId("channel-members")).getByText(/online/i)).toBeTruthy();
});
```

**Red at `cf87e6f6`.** It is the smallest statement of §4.3 and it belongs beside the fix.

### 7.5 The gate that makes this class unexpressible

A doc rule is not a gate. Once Wave 1 lands, the type in §6.2 is what enforces additivity — a slot
whose return type is a **record of named regions** cannot be handed a body. Prefer that over a new
`check-*-drift.ts`: this audit found the class is ONE slot, and a script guarding one slot costs more
than the type that deletes it. **If a second body-replacing slot is ever proposed, that is the moment
to write the gate** — and its doc row in CLAUDE.md § *Definition of green*, in the same change
(CLAUDE.md's standing warning: the wave that adds a gate does not add its doc row, three times now).

---

## 8. Corrections this audit owes the other parity docs

Each belongs in the Wave 1 change that touches the file, per CLAUDE.md's *"doc repairs, each in the
change that touches the file"*.

1. **`00-MASTER.md` §4.4** cites the agent-stats duplicate at `pages/agent-window/agent-window.tsx:403-439`.
   That body lives in **`src/features/channels/components/agent-window.tsx › AgentWindowStats`**;
   `apps/desktop-ui/src/pages/agent-window/index.tsx` is the page that mounts it. The pair is
   `agent-panel.tsx › AgentStats` vs `agent-window.tsx › AgentWindowStats`, both in the shared tree.
2. **`01-channel-surface.md` §C2** puts the /home Members-heading row and the two `IconButton`s in the
   "✘" column without saying which side is right. They have **no `onClick`** in the shared body
   (`info-tab.tsx › InfoTab`), so /home's count-only heading is the correct one and R-46 is a
   deletion, not a port.
3. **`01-channel-surface.md` §B** rates `capabilities.knowledge` *"⚠ NEITHER — it is now unreachable
   on every host"*. Confirmed at `cf87e6f6` by measurement, not by reading: no host passes it in
   code. §E-4 / R-18 / X4 are correct as written.
4. The Wave-0d brief's shorthand **"partly fixed via headerEdit / mentions / activityBins"** is wrong
   on `activityBins` — see §4.1. `00-MASTER.md` §4.2 already has it right.

---

## 9. Confidence and gaps

### Confident

- **The counts in §2 and the classification in §3.** Every row was opened and read; the two
  derivation commands are in §1 and §5 and both take a second.
- **§4.2's body diff.** Both files read end to end at `cf87e6f6`. It reproduces
  `01-channel-surface.md` §C2's findings and adds the `viewerUserId` row, which §C2 does not have.
- **§4.3, the presence defect.** Three files, one expression, no inference:
  `person-members.tsx` passes no `viewerUserId` · `MemberRoster` forwards it ·
  `isPresentForViewer` needs it and is the only caller of `isSpaRenderer()` on that path.
- **F1's missing `color`.** `overlays.tsx › ChannelsOverlays` has no `color` prop on its
  `ChannelsAgentPanel`; `surface-agent-view.tsx › SurfaceAgentView` does.

### Gaps

0. ✅ **GAP 1 IS ANSWERED BY EXECUTION, AND THE ANSWER IS "NONE OF THEM MOVED" (wave 1A,
   2026-09-17).** Seven /home files were predicted to die or be rewritten. What actually happened:
   **every case in all seven still passes, unedited** — six were RENAMED (`person-info-tab*` →
   `home-info-*`, `person-thread-activity` → `home-channel-activity`) and their docblocks corrected,
   and not one assertion changed. The reason is the finding: those suites mount through `HomePage`
   against a real bridge and assert what the /home HOST puts on screen, which was never the fork's
   to own. What DID move is `surface-slot-fixtures.tsx › standaloneSurfaceStub` — it renders the
   REAL `InfoTab` now and makes the surface's reads — plus the **two inverting cases in
   `channel-surface.test.tsx`**, rewritten as four, and `index.test.tsx`'s inline sixth copy of the
   stub, deleted. **The count that mattered was the STUB, not the assertions.**

1. ~~**NOBODY HAS COUNTED THE ASSERTIONS THAT MOVE.**~~ Seven test files die or are rewritten in step 4
   — `person-info-tab.test.tsx`, `-description`, `-edit`, `-mentions`, `-mentions-inset`, `-peers`,
   and `person-thread-activity.test.tsx` — plus `surface-slot-fixtures.tsx › standaloneSurfaceStub`
   and the two inverting tests in §7.3. `01-channel-surface.md` § *Confidence and gaps* named this
   gap on 2026-09-17 and it is **still open**: this audit counted the FILES, not the assertions
   inside them. That count is Wave 1's first task, not this doc's.
2. **The `stats` slot's two bodies (F4) were diffed by eye, not by test.** They differ on the
   `Started …` fragment and on `className`; whether anything else has drifted is P17's measurement.
3. **The 78 is a slot count, not a prop count.** A slot reached through an intermediate component
   (e.g. `ontology-view.tsx › settingsMenu` → `board-header-bits.tsx › hostRows`) is counted once, at
   each declaration — so the two ends of one chain appear as two rows. That is deliberate: each
   declaration is a place a future host can replace a body.
4. **`src/app/` was swept for FILLS, not for declarations.** The Next tree declares no slots of its
   own (it is hosts and routes); `grep -rn "={<\|={(" src/app --include='*.tsx'` returns two fills,
   both in §3. If that ever stops being true, re-run §1's command with `src/app` added.
