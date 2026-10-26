# UI staging — shared frame

Staging pages show one desktop /home face inside the landing hero's demo window, with fake data,
so UI changes can be seen on the web dev server with HMR and later ported back to `apps/desktop-ui`.

The frame's own staging → desktop map is `./PORTING.md`. Routes (each has a `PORTING.md` in
`src/features/<face>-staging/`):

| Route | Public copy (use this one) | What |
|---|---|---|
| `/overview` | `/playground/overview` | /home → Overview |
| `/channels` | `/playground/channels` | the landing demo's channel face, clickable |
| `/knowledge` | `/playground/knowledge` | /home → Knowledge |
| `/identities` | `/playground/identities` | /home → Identities |
| `/ontology` | `/playground/ontology` | /home → Ontology |
| `/popups` | `/playground/popups` | catalog of every global popup and window (+ Settings, `settings-staging/`) |

The `/playground/*` copies are the PUBLIC ones (see "Public access"); the top bar's tabs link there.

## Use

```tsx
// src/app/<face>/page.tsx
import { StagingFrame } from "@/features/ui-staging/staging-frame";
import { MyStagedFace } from "@/features/<face>-staging/...";

export default function Page() {
  return (
    <StagingFrame tab="knowledge">
      <MyStagedFace />
    </StagingFrame>
  );
}
```

`StagingFrame` props:
- `tab`: which top-bar tab is underlined (`overview | channels | knowledge | identities | ontology`).
- `showChannels`: draw /home's 290px channel column beside the pane. **On by default**
  (2026-10-22): desktop /home keeps `<RelationshipList>` on every tab, so every staged face
  carries the picker too. Client-only; the column's width is held until it mounts. Pass `false`
  only for a page that is not a /home face.
- `channelColumn`: a face's own column node in that slot (`/channels` passes the shared rail wired to its store); wins over `showChannels`.
- `tabHrefs`: tab → href map (default `STAGING_ROUTES` in `staging-top-bar.tsx`, which points every tab at its public `/playground/<face>` alias; `{}` = inert tabs).
- `onNew` / `newLabel`: replace the top bar's lead pill handler / label. Without `onNew` the pill opens
  the frame's staged New channel dialog (see "Popups").
- `recordClassName`: extra classes on the record pane (`.lp-demo-record`, already `display:flex`).

`children` land inside the record pane, which is the same box desktop /home's
`HomePane` renders into (`flex min-w-0 flex-1 overflow-hidden`, white card, `data-frame-skin`).

## Popups (frame triggers)

`StagingFrame` mounts `staging-popups-provider.tsx` once, so every page gets these for free:

| Frame trigger | Opens |
|---|---|
| top bar "New channel" pill | `popups-staging › StagingNewChannelDialog` (`/channels` subscribes to its create, so the row lands in its column) |
| top bar search pill | the product pill + popup (`search/components/header-search.tsx`) over `data/search-results.ts` |
| top bar profile pill | `settings-staging › StagingSettingsModal` on Account; every row switches inside |
| rail dashed "+" | `popups-staging › StagingRequestWorkspaceAccess` |
| an incoming toast's click / action | thread window (`thread:*`) or agent window (`consent:*`, `resume`) |

Also app-level, as desktop `app.tsx` mounts them: `RuntimeSignInPrompt` and `IncomingToasts`.
Inside a frame, `useStagingPopups()` opens the same instances (`open(key)`, `openSettings(section,
plan)`, `openSearch()`, which focuses the search field); `/popups`' catalog buttons use it. Overlays render beside the window, not
inside the scaled canvas (a fixed box under a `transform` is placed against it).

## Files

| File | What |
|---|---|
| `staging-frame.tsx` | The window: hero stage + account rail + panel + top bar + channel picker + record pane + the popup provider. Imports `marketing.css` and the demo's rows. |
| `staging-channel-rail.tsx` | The left-hand **channel picker**, on every face (desktop `relationship-list.tsx`). Copy of `banner-demo/demo-home-faces.tsx › DemoChannelSwitcher`, made clickable: wells toggle, and a row either selects in place (`onSelect`, which `/channels` passes) or links to `/playground/channels`, the way a desktop pick raises the channels face. The one copy: `/channels` mounts it directly. |
| `staging-top-bar.tsx` | Copy of `banner-demo/demo-home-faces.tsx › DemoTopBar` with a selectable tab; tabs are `next/link`s to the staging routes (`STAGING_ROUTES`); the search pill is the product's `HeaderSearch`, the profile pill a button. |
| `data/search-results.ts` | The search popup's answers from the staged story, through `search-fixtures.ts › createFixtureFetcher` (filtered and highlighted client-side, no fetch), plus seeded recents. |
| `staging-account-rail.tsx` | Copy of `banner-demo/demo-home-chrome.tsx › DemoAccountRail`; the "+" is a button. |
| `staging-popups-provider.tsx` | The frame's popups (table above) + `useStagingPopups()`. |
| `staging-scenario-switch.tsx` | The floating "States" pill (used by `/knowledge` and `/identities`). Staging-only. |
| `staging-frame.test.tsx` | Every frame trigger opens its popup, no fetch. |
| `staging.css` | The stage around the window (`.uis-*` only). Also the desktop CSS bridge notes. |
| `staging-stubs.ts` | Shared fake people, home-workspace id and a FIXED clock (`minsAgoIso`) to keep SSR/CSR stamps equal. |

## Desktop CSS

`apps/desktop-ui/src/styles/{tokens,kit}.css` are a hand-copied subset of
`src/app/globals.css` (every desktop kit class and token var exists there, checked
2026-10-22), so desktop components render with the right tokens on the web with no
extra stylesheet. The stage sets the desktop's body font (`var(--font-app)`); the hero
itself inherits Helvetica from the landing's `.lp` wrapper.

## Public access

These routes are NOT public yet: `src/proxy.ts` redirects a signed-out visitor to
`/login` for any path not in `src/shared/auth/public-routes.ts › PUBLIC_ROUTES`.
Signed in on localhost they render. To make them public, add the staging paths to
`PUBLIC_ROUTES` (an edit to an existing file, left to Samuel). Until then a public alias
works because `/playground` is already a public prefix: `src/app/playground/<face>/page.tsx`
re-exports `/<face>` for all six routes.

## Rules

- Never fetch, never touch Supabase or the Electron bridge: stub every hook with local data.
- Keep staged file names mirroring the desktop/shared source files, with a `PORTING.md`
  per face folder mapping staging file to source file.
