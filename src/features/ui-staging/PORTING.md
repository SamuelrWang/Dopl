# UI-staging frame → desktop porting map

The shared window every staged face sits in. What the frame draws is desktop /home's SHELL
(`apps/desktop-ui/src/pages/home/index.tsx`), faced with the landing demo's chrome
(`src/features/marketing/components/banner-demo/`, `marketing.css › .lp-demo-*`). Read
`./README.md` first; design rules are `docs/DESIGN-LANGUAGE.md`.

## Files that are copies (port changes back)

| Staging file | Demo source | Desktop / product file it mirrors |
|---|---|---|
| `staging-frame.tsx` | `banner-demo/demo-home-chrome.tsx` + `demo-scene.tsx` (the window half) | `pages/home/index.tsx` (account rail + `.page-float` panel + header + the one `flex min-h-0 flex-1` row holding picker and record pane) |
| `staging-top-bar.tsx` | `demo-home-faces.tsx › DemoTopBar` | `pages/home/home-header.tsx` (lead cell "New channel" + face selector + search + Profile) |
| `staging-account-rail.tsx` | `demo-home-chrome.tsx › DemoAccountRail` | `shared/layout/app-shell › AccountRail` |
| `staging-channel-rail.tsx` | `demo-home-faces.tsx › DemoChannelSwitcher` (+ its `Row`) | `pages/home/relationship-list.tsx` + `pages/home/channel-wells.ts` (wells), `shared/ui/home-channel-row.tsx` (the row face) |
| `staging-popups-provider.tsx` | — | `apps/desktop-ui/src/app.tsx` (the app-level popups) + `pages/home/new-channel-dialog.tsx`, `home-search-popup`, the settings modal |

## The picker is frame-level (Samuel, 2026-10-22)

> "across all five pages in the actual desktop app, the left-hand channel picker and the new
> channel button should still be on those pages as well. That's not the case with this
> playground right now, so that's the first thing that needs to be fixed."

Desktop already behaves that way and needs no port for the BEHAVIOUR: `index.tsx` renders
`<RelationshipList>` inside the one layout row for every tab, and `home-header.tsx`'s lead
cell (`w-[var(--home-list-w)]`) holds the one "New channel" button above it. Staging had the
column off by default and only `/channels` and `/overview` drew one. Fixed in the frame:
`showChannels` now defaults to true, so all six routes carry it.

Staging-only differences in the rail, which do NOT port:
- A row with no `onSelect` is a `next/link` to `/playground/channels`. Desktop selects the row
  and raises the channels face in local state (`index.tsx › onSelect`); a staged face has no
  store to select into, so hopping to the channels page is the equivalent.
- Well open/closed is local `useState`. Desktop persists it (`channel-wells.ts`).
- The rows are the demo's fixtures (`demo-home-rows.ts › homeRowsAt`), so they print
  clock-relative stamps off a module-load clock: the frame mounts the rail client-side only and
  holds the column's width with `StagingChannelRailPlaceholder` until then.

## The channel row: one height in every case (playground only, awaiting Samuel)

> "I want each of the channel pickers to be the same size regardless ... Ideally, all three things
> would fit together in a good way. I don't want there to be a bunch of extra blank space"

`staging-channel-rail.tsx › RowBody` is built on the product's own kit (`white-card raise`, the
`home-card-marks.tsx` marks, `IdentityStack`), no staging CSS. Two lines, each `h-5`:

| Case | Line one | Line two |
|---|---|---|
| description + people | name · time | description (truncates) · faces (18px, max 3, +N) · marks |
| description, solo | name · time | description · marks |
| no description + people | name · time | "with Grace, Anthony" (first names) · faces · marks |
| no description, solo | name · time | "Just you" · marks |
| unclaimed link | name (dimmed) · time | "Not yet claimed" · Invited |

Port target: `shared/ui/home-channel-row.tsx › HomeChannelRow` (desktop /home and the landing demo
both render it). The port replaces its `showDescription` either/or with the row's `subline` rule,
moves the stack after the text and pins both lines at `h-5`; `relationship-list.tsx` already passes `description` for every channel. `/playground/channels` shows all four cases (`channels-staging/data/row-case-fixtures.ts`).

## CSS

Every override is `src/features/ui-staging/staging.css`, scoped `.uis-window`, and each block
names its port target. For the picker:

| Staging block | Port target |
|---|---|
| "THE SHARED CHANNEL PICKER" (scroll, link reset, well-heading button) | `pages/home/relationship-list.tsx` |
| "WHITE PANEL TRIAL" | `globals.css › .page-float` / `--home-panel` |
| "TOP TABS" | `marketing.css › .lp-demo-top-tab` → `pages/home/home-header.tsx`'s `SegmentedControl` |

Literals here become tokens/kit recipes on the way into the product
(`src/app/globals.css` + `apps/desktop-ui/src/styles/tokens.css` + `docs/DESIGN-SYSTEM.md`);
the product forbids hand-rolled values.

### ⚠ This sheet is global to all six playground routes (measured 2026-10-23)

`staging.css` is imported by `staging-frame.tsx`, and every staged page mounts that frame, so
**every selector in this file reaches all six `/playground/*` routes**, not just the face whose
block it sits in. Scope each rule under `.uis-window` and its own prefix; an unscoped selector
here is a cross-route rule whoever wrote it did not intend. The rules at the top of the file
(`a.lp-demo-top-tab`, `button.uis-rail-create`, `button.lp-demo-top-profile`) are unscoped — intended for the shared top bar, but they are the
shape to avoid copying.

It does **not** reach the real landing page. Measured: the landing route loads only
`app/layout.css` + `app/page.css`, and both contain zero `uis-*` selectors; its `lp-demo-*`
hits are `marketing.css`'s own, which is where those classes legitimately live. Nobody should
"fix" the landing page over a rule seen in this file.

**The general lesson, which cost four false conclusions on 2026-10-23: read the BUNDLE the
route ships, not the file the rule lives in.** A selector's location says nothing about which
pages load it, exactly as a class in markup says nothing about whether a rule was emitted.
Both confuse where a name appears with what actually ships. Standing Rules
(`orchestration-guidelines › Plans/UI Standing Rules`) carries this in the
**cache-invalidation instance of rule 6 (prove the style exists)** — that rule has TWO bodies
on purpose, cache invalidation and the subgrid toolchain incident, so the instance is named
rather than the number cited. A numbered rule is an address: inserting into the list
silently re-points every citation, and counting points to disambiguate only holds while
nobody trims the list.

## Stand-ins (do NOT port)

`staging-stubs.ts` (fake people + a fixed clock), `staging-scenario-switch.tsx` (the floating
"States" pill), and every `STAGING_ROUTES` href. They replace network/Electron code or exist
only to drive the staging pages.
