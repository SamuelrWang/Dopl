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
first (2026-10-26), so the column stays the landing demo's `DemoChannelSwitcher` face
(`marketing.css › .lp-demo-sw*`), made clickable:
- a row with no `onSelect` links to `/playground/channels`; desktop selects the row and raises the
  channels face (`index.tsx › onSelect`);
- well open/closed is local state; desktop persists it (`channel-wells.ts`);
- the rows are the demo's fixtures (`demo-home-rows.ts › homeRowsAt`) with clock-relative stamps, so
  the frame mounts the rail client-side only and holds the width with `StagingChannelRailPlaceholder`.

`staging.css`'s column block (scroll, link reset, well-heading button, the rows' lift) is the port
target when the redesign lands: `pages/home/relationship-list.tsx` and `shared/ui/home-channel-row.tsx`.

## Stand-ins (do NOT port)

`staging-bridge.ts`, `staging-app-bridge.ts`, `staging-stubs.ts`, `staging-scenario-switch.tsx`,
`STAGING_ROUTES`, and the stage (`.uis-stage`, `.uis-window`, the scaled canvas). They replace
network/Electron code or exist only to drive the staging pages.

⚠ `staging.css` is imported by `staging-frame.tsx`, so every selector in it reaches all
`/playground/*` routes; scope each rule under `.uis-`. It does not reach the landing page (the
landing route loads only `app/layout.css` + `app/page.css`).
