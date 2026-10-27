# UI-staging frame → desktop porting map

The window every staged face sits in. Read `./README.md` first; design rules are
`docs/DESIGN-LANGUAGE.md`.

## Product, mounted directly (2026-10-26)

| In the frame | Product file | Desktop mount |
|---|---|---|
| account rail | `src/shared/layout/app-shell/account-rail-core.tsx` (+ `account-rail.module.css`) | `components/app-shell/account-rail.tsx` binds the packaged mark |
| panel, header strip, record pane | `src/features/home/components/shell/home-frame.tsx` (+ `home.module.css`) | `pages/home/index.tsx` |
| header (New channel, face tabs, search, Profile) | `src/features/home/components/shell/home-header.tsx` | `pages/home/index.tsx` |
| Profile pill + Settings modal | `home/components/shell/home-settings-control.tsx` → `shared/layout/settings-modal/desktop-settings-modal.tsx` | same |
| app-level popups | see `popups-staging/PORTING.md` | `app.tsx`, `pages/home/index.tsx` |

The shell root is `app-shell.module.css › .root`, as on desktop. The one token the trees disagree on
is `--shell-rail-w` (web 0px, desktop 54px); `staging.css › .uis-window` sets the desktop's.

## Kept: the playground's own channel column

`staging-channel-rail.tsx` is NOT the product list (`apps/desktop-ui/src/pages/home/relationship-list.tsx`).
Samuel is redesigning the channel picker rows (name, description, member faces) in the playground
first (2026-10-26), so the column stays the playground's: the landing demo's `DemoChannelSwitcher`
column (`marketing.css › .lp-demo-sw*`) with kit-built rows (below), made clickable:
- a row with no `onSelect` links to `/playground/channels`; desktop selects the row and raises the
  channels face (`index.tsx › onSelect`);
- well open/closed is local state; desktop persists it (`channel-wells.ts`);
- the rows are the demo's fixtures (`demo-home-rows.ts › homeRowsAt`) with clock-relative stamps, so
  the frame mounts the rail client-side only and holds the width with `StagingChannelRailPlaceholder`.

`staging.css`'s column block (scroll, well-heading button) is the port target for
`pages/home/relationship-list.tsx` when the redesign lands.

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

## Stand-ins (do NOT port)

`staging-bridge.ts`, `staging-app-bridge.ts`, `staging-stubs.ts`, `staging-scenario-switch.tsx`,
`STAGING_ROUTES`, and the stage (`.uis-stage`, `.uis-window`, the scaled canvas). They replace
network/Electron code or exist only to drive the staging pages.

⚠ `staging.css` is imported by `staging-frame.tsx`, so every selector in it reaches all
`/playground/*` routes; scope each rule under `.uis-`. It does not reach the landing page (the
landing route loads only `app/layout.css` + `app/page.css`).
