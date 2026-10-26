# Open questions (overnight run 2026-10-26)

Workers append a `## <slice>` section per question: the question, what was chosen, where.

## Phase 1 UI primitives (branch `ui/port-primitives`)

1. **Moving `PairedAvatar` whole would break the landing demo.** Its raised frame needs
   onboarding's `web-pieces.tsx › Profile`, and `banner-demo/*` (off limits this phase) calls
   `thinFrame`. Chose: the thin recipe moved to `src/shared/ui/identity-face.tsx › IdentityFace`;
   `onboarding/components/paired-avatar.tsx › PairedAvatar` keeps its props and renders
   `thinFrame` through `IdentityFace`, and keeps the raised onboarding frame. Onboarding importers
   needed no change. Retire `PairedAvatar thinFrame` with the banner-demo swaps (R2).
2. **`channels-staging/data/staging-agents.ts › stagingIdentityFace` builds face DATA (photo,
   colour, logo), not markup.** Kept as the staging data source; every renderer of it is now
   `IdentityFace`.
3. **Which badge shadow is the recipe?** Staging `TaskFace` used the bevel only; `PairedAvatar`
   and the identities fork used bevel + two drops. Chose the latter as the token
   `--raised-light-drop` (globals + tokens.css), read by `IdentityFace` and onboarding's `Face`.
   The tasks faces' badges gain that soft drop.
4. **Which status pill is THE pill?** Three faces exist: the tasks word pill, the demo agent card's
   `.lp-demo-ac-status` (2px pad, weight 500, dot) and identities-staging's white-on-hairline
   `StatusPill`. Chose the tasks geometry for `.status-pill` with an optional dot; the other two are
   not swapped (not a direct swap). Needs Samuel's pick before Phase 3 restyles agent cards.
5. **`CARD_BUTTON` lives in `channels/components/bits.tsx`** (the channels tree is the rename
   worker's this phase). Not touched; DESIGN-SYSTEM's `PILL_BUTTON` row names the family and
   leaves `CARD_BUTTON` for the channel page restyle.
6. **`AvatarStack` vs the identity stack.** Product `AvatarStack` callers (relationship list etc.)
   must not change look this phase, so `IdentityStack` was added beside it in `avatar-stack.tsx`.
   Collapse them when the product callers are restyled.
7. **Visual deltas accepted (all small, all toward the shared recipe):** settings cards
   `#ffffff` + 6/16/.04 shadow → `.white-card` (`#fefefe`, `--shadow-bento`); Add members
   initial circle and "Member" pill → `IdentityFace` / `StatusPill` (raised hairline, `--bg-inset`,
   `text-micro`); the quick view's "All tasks resolved" gains the check icon its tab twin has;
   outlined pills `#ffffff` → `--bg-overlay`; an agent with no colour key rings `neutral` instead of
   `agent-01`; an identities run with no runtime keeps its agent-colour ring (was grey);
   `PairedAvatar thinFrame` without a logo draws no badge (was a grey block).
8. **13px was already a token** (`--text-lead`); the staging literals now read it. 15px was missing
   and is `--text-heading` (both token files, DESIGN-SYSTEM type table).
9. **Pre-existing red, not this slice:** `src/shared/ui/clickable-cursor.test.ts` flags
   `ontology-staging/ontology/components/kanban-column-header.tsx` (untouched here).
   `identities-staging/page/identity-activity-panel.test.ts › scopes every rule to .uis-window` was
   red on master (unscoped `.uis-tk-idface*` and `.uis-st-people*` rules); green now, since both
   rule sets were deleted for the shared primitives.

## Phase 2 shell (branch `ui/port-shell`)

1. **The 1px line is kit-wide.** `.page-float` (both kit copies) and the account palette skin went
   to the 1px hairline, so the workspace shell's panel and the other `.page-float` mounts thin too
   (a /home change that bleeds, per R12). The workspace shell's routed card
   (`app-shell.module.css › .pageCard`) still says 2px: changing it is workspace-only work, so it
   was left and `frame-palette.test.ts` pins it as is. Needs Samuel's call on R-38 parity.
2. **Profile pill's accessible name** is the visible first name; `title="Profile"`. With no
   display name it reads "Profile" over an `IdentityFace` "?" fallback. The page now gates on
   `GET /api/user/profile` (failure falls back, never errors the page) so the pill paints whole.
3. **Row details taken from staging over older rulings:** a solo channel's description is no
   longer italic (2026-09-15 ruling; staging has none); a pending link's name dims by opacity 60%
   instead of `text-text-secondary`; the selected name is semibold.
4. **Heading-to-first-row gap is 8px (staging 6px)** because the `"heading"` well keeps the shared
   collapse's 8px top bleed (`collapse-wells.tsx › WELL_FACES`); rows are 6px apart as staged.
5. **New channel is its own flat ink face (`.raise-ink`), not `PAGE_ACTION_BTN`.** The 3D page
   pill is worn by the section create buttons on the other four faces and the channel page, which
   this slice does not restyle. Collapse the two when those faces move.
6. **The landing demo still draws its own header and column** (`demo-home-faces.tsx`,
   `.lp-demo-top*` / `.lp-demo-sw*`), now the same look as the product: two implementations until
   R2's demo swap cleanup (Phase 5). The dead product-faithful `DemoHomeHeader` / `DemoChannelList`
   were deleted here. `HomeChannelRow` has no renderer outside the SPA now; it stays in
   `src/shared/ui` because the demo authors its rows as `HomeChannelRowFacts`.
7. **`--channel-divider-w` has no declarer any more**: every divider is the kit hairline, so
   `split-resize-handle.tsx`'s strip always takes its 1px fallback. The variable and
   `info-resize-handle.tsx`'s re-export can retire with the info-column slice (channels tree).
8. **Stale pointer left in the channels tree:** `channels/components/use-info-resize.ts` names
   `frame-palette.test.ts` as the `--info-w` pin; those cases moved to
   `apps/desktop-ui/src/components/app-shell/info-column.test.ts` (the 500-line split). Not edited:
   the rename worker owns that tree today.
9. **Search stays an always-open input** (staging's pill is a button that swaps in a field): it
   lifts on hover and holds still while focused (`.raise-pill:focus-within`).
10. **Worktree environment:** the main checkout's `packages/contracts` carries another worker's
    in-flight edits, and a whole-directory `node_modules` symlink resolves `@dopl/contracts` there
    (the SPA typecheck then fails on `task_*` kinds in untouched files). This worktree's
    `node_modules` is per-entry links with `@dopl/*` pointing at its own packages.
11. **Pre-existing red, unchanged:** `src/shared/ui/clickable-cursor.test.ts` still flags
    `ontology-staging/ontology/components/kanban-column-header.tsx` (Phase 1 item 9).
