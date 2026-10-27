# UI staging — shared frame

Staging pages show one desktop /home face inside the landing hero's window, on fake data, so UI
changes can be seen on the web dev server with HMR. Since 2026-10-26 the window's shell is the
PRODUCT's (account rail, panel, header, Settings, popups), so the playground and the desktop app look
at the same page; the frame map is `./PORTING.md`.

| Route | Public copy (use this one) | What |
|---|---|---|
| `/overview` | `/playground/overview` | /home → Overview |
| `/channels` | `/playground/channels` | the landing demo's channel face, clickable |
| `/knowledge` | `/playground/knowledge` | /home → Knowledge |
| `/identities` | `/playground/identities` | /home → Identities |
| `/ontology` | `/playground/ontology` | /home → Ontology |
| `/popups` | `/playground/popups` | catalog of every global popup and window (`popups-staging/`) |
| `/system` | `/playground/system` | the design system reference sheet (`./system/`) |

The `/playground/*` copies are the PUBLIC ones; the header's tabs go there (`STAGING_ROUTES`).

## Use

```tsx
// src/app/<face>/page.tsx
import { StagingFrame } from "@/features/ui-staging/staging-frame";

export default function Page() {
  return (
    <StagingFrame tab="knowledge">
      <MyStagedFace />
    </StagingFrame>
  );
}
```

`StagingFrame` props:
- `tab`: which header tab is selected (`null` for a page that is no /home face). It also sets the
  panel's `data-face`, so each face gets the product's surfaces (`home.module.css`).
- `showChannels`: draw the channel column (default on, as desktop keeps it on every face).
- `channelColumn`: a face's own column in that slot (`/channels` passes the rail wired to its store).
- `onNew`: replace the header's "New channel" handler (default: the product New channel dialog).
- `recordClassName`: extra classes on the box the face renders into (a flex row).

## The bridge

Product components read `window.dopl` (`shared/lib/spa-bridge.ts`). The playground installs an
in-memory one (`staging-bridge.ts`) built from LAYERS: the frame's base layer
(`staging-app-bridge.ts`: Settings, the /home writes, search, runtime sign-in, the launch record,
toasts) and a face's own server (`knowledge-staging/staging-bridge.ts`, `ontology-staging`). A face
layer outranks the base for a route both serve. Nothing reaches the network.

## Popups

`staging-popups-provider.tsx` mounts the app-level popups once (New channel, request workspace
access, the two pop-out windows, `RuntimeSignInPrompt`, `IncomingToasts`); `useStagingPopups()` opens
them and `openStagingSettings(section, plan)` opens the header's Settings modal.

## Files

| File | What |
|---|---|
| `staging-frame.tsx` | The window: hero stage + scaled 1280px canvas + the product shell + the popups. |
| `staging-channel-rail.tsx` | The playground's OWN channel column (Samuel is redesigning its rows here first, 2026-10-26); rows select in place (`onSelect`) or link to `/playground/channels`. Not the product list. |
| `staging-bridge.ts` / `staging-app-bridge.ts` | The layered `window.dopl` and the frame's layer. |
| `staging-popups-provider.tsx` | The frame's popups + `useStagingPopups()` + `openStagingSettings`. |
| `data/search-results.ts` | The search answers, served as the bridge's `/api/search`. |
| `staging-scenario-switch.tsx` | The floating "States" pill (used by `/knowledge` and `/identities`). |
| `staging-stubs.ts` | Shared fake people, the home identity and a FIXED clock (`minsAgoIso`). |
| `staging.css` | The stage around the window and the channel column's resets (`.uis-*` only). |
| `staging-frame.test.tsx` | Every frame trigger opens its popup, no fetch. |

## Public access

These routes are NOT public: `src/proxy.ts` redirects a signed-out visitor to `/login` for any path
not in `src/shared/auth/public-routes.ts › PUBLIC_ROUTES`. `/playground` is a public prefix, so
`src/app/playground/<face>/page.tsx` re-exports `/<face>` for all six routes.

## Rules

- Never fetch, never touch Supabase or the real Electron bridge: serve fake data through a bridge
  layer and mount the product component.
- A copy is the last resort (a routed SPA page the Next tree cannot import); list it in the face's
  `PORTING.md` with why.
