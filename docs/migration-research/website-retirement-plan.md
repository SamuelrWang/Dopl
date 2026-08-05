# Website retirement plan — what stays, what goes, how, and in what order

Phase-4 execution plan for [DESKTOP-MIGRATION-PLAN.md](../DESKTOP-MIGRATION-PLAN.md).
Builds on [journey-audit.md](./journey-audit.md) (the 23-gap Phase-4 gate),
verified against the tree as of 2026-08-03 on branch `min-version-gate`
(desktop `1.8.2`, SPA default shell since 1.8.0, `DOPL_UI=remote` is the
rollback). Everything below is re-verified against code, not the older research
docs — the tree has moved a long way since the audit snapshot.

**Fixed inputs (Samuel's standing directives):**
- The landing page stays. The public marketing surface survives.
- ALL OAuth surfaces stay, including `/login` and `/oauth/authorize`.
- The server/API is not retired. "Retire the website" = retire the logged-in
  web APPLICATION pages. The Next.js deployment remains as pure API + kept pages.
- Deploys/releases are Samuel's gate. This is a plan, not an execution.

**The one-paragraph verdict.** The SPA has quietly closed most of the audit's
S1/S2 gaps (signed-out screen, all-provider sign-in over the bridge, channels +
notification click-through, onboarding, app-origin seam, avatars). What still
tethers the desktop product to the web app tree is exactly two flows, and both
funnel through the same page: **`/{segment}/canvas` in the browser is the
desktop's payment surface** (`apps/desktop-ui/src/lib/open-in-browser.ts` →
`billingPath()`) **and its account-deletion surface**
(`apps/desktop-ui/src/components/settings-modal/account-actions.tsx`). Stripe's
`return_url`s and the API's 402 `upgrade_url` point at the same `/canvas?billing=…`
target. Build one small replacement page, repoint four URL builders, and the
entire `[workspaceSlug]` tree becomes deletable. Everything else is mechanics.

---

## 1. Full route inventory

Classification legend:
- **KEEP-CRITICAL** — product function depends on it post-retirement.
- **KEEP-PUBLIC** — public marketing/legal/SEO surface.
- **RETIRE** — product UI replaced by the bundled SPA.
- **DECIDE** — genuinely ambiguous; Samuel call (marked `D#`, tradeoffs in §7).

### 1.1 Page routes — top level (17)

| Route | File | Class | Notes / replacement / inbound-request fate |
|---|---|---|---|
| `/` | `src/app/page.tsx` | **KEEP-PUBLIC** | Landing (`SiteNav` + `Hero`). Hosts the only DMG link (`src/features/marketing/constants.ts:24`). Gains the "Dopl is now a desktop app" role at cutover. |
| `/pricing` | `src/app/pricing/page.tsx` | **KEEP-PUBLIC** | 18 lines; linked from `site-nav.tsx`. Cost of keeping ≈ zero; folding into the landing modal is optional cleanup, not retirement work. |
| `/terms`, `/privacy` | `src/app/{terms,privacy}/page.tsx` | **KEEP-PUBLIC** | GAP-17 resolved: legally load-bearing (login consent copy `login-form-core`, the SPA's signed-out screen links them via `openInBrowser`, Stripe + Google OAuth verification expect live URLs). Already in `PUBLIC_ROUTES` (`src/proxy.ts:21-22`). |
| `/login` | `src/app/login/page.tsx` | **KEEP-CRITICAL** | Standing directive. Backs the `/oauth/authorize` signed-out bounce, browser-side sign-in, and the retired-page escape hatch into the kept billing surface. Google One Tap keeps its `NEXT_PUBLIC_GOOGLE_CLIENT_ID` alias (`next.config.ts`). |
| `/oauth/authorize` | `src/app/oauth/authorize/page.tsx` | **KEEP-CRITICAL** | Standing directive. MCP/Claude-connector consent. Depends on `/login` (bounce with preserved OAuth query). |
| `/auth/callback` | `src/app/auth/callback/route.ts` | **KEEP-CRITICAL** | Every Supabase auth email and OAuth return lands here. Desktop path (`?desktop=1`) → `/auth/desktop-handoff` with the CSRF `state` echoed. **Browser path defaults to `/canvas`** (`safe-redirect.ts:30`) — must be repointed at cutover (§2.4). |
| `/auth/desktop-start` | `src/app/auth/desktop-start/page.tsx` | **KEEP-CRITICAL** | Desktop OAuth entry, now provider-parameterized (`?provider=github`, google default) with `state` nonce echo — GAP-2's OAuth half is closed. |
| `/auth/desktop-handoff` | `src/app/auth/desktop-handoff/page.tsx` | **KEEP-CRITICAL** | Builds `dopl://auth#tokens`. Also the direct `redirect_to` of desktop magic links (`dopl-desktop-app/main/auth-password.js:133`). |
| `/auth/desktop-complete` | `src/app/auth/desktop-complete/page.tsx` | **RETIRE (deferred)** | Resolves the plan-vs-auth-flows disagreement (GAP-22): it exists solely so the **remote rollback shell** can plant its cookie jar (`main/index.js` loads it only when `!isSpaMode()`). It retires **with** the remote-shell code path (Stage D), not before. |
| `/auth/reset-password` | `src/app/auth/reset-password/page.tsx` | **KEEP-CRITICAL** | GAP-8 resolution: recovery emails route `/auth/callback?redirectTo=/auth/reset-password` (`use-login.ts:76-78`). An auth-broker surface by the plan's own definition. Add to the Phase-4 KEEP list explicitly. |
| `/canvas` (top-level boot) | `src/app/canvas/page.tsx` | **RETIRE (staged)** | Today the target of: Stripe `return_url`s (`stripe.ts:112,145`), `upgradeUrl()` 402 envelopes (`entitlements.ts:158-160`), pre-1.8 wrapper `HOME_URL` (`main/config.js:10`), browser sign-in default redirect. Retire only **after** all four are repointed (§2.4); middleware then 302s it → new billing page when `?billing=` is present, else → retired page. |
| `/onboarding` | `src/app/onboarding/page.tsx` | **RETIRE** | Replaced by the SPA's `/onboarding` route (`apps/desktop-ui/src/pages/onboarding`, registered in `routes.tsx:75`). Inbound: browser signups get repointed by the callback (§2.4); middleware 302 → retired page. |
| `/invite/[token]` | `src/app/invite/[token]/page.tsx` | **DECIDE (D2)** | GAP-4: no invitation email is ever sent (`invitations.ts:58-61`), no UI exposes the token URL, so the only inbound is a hand-copied address-bar URL. Recommendation: retire the page AND the token-URL surface; invites remain discoverable in-app (members page is ported). Keep-a-bounce is the alternative if Samuel wants the URL to stay live. |
| `/join/[token]` | `src/app/join/[token]/page.tsx` | **KEEP-CRITICAL (as bounce)** | GAP-6: this URL is a first-class UI affordance — the app copies `${getAppOrigin()}/join/{token}` to clipboards **today** (`invite-dialog.tsx:72`), so live links exist in the wild forever. Keep the page; rework its success path ("request sent — open the Dopl app / download") and **add `/join/` to `PUBLIC_ROUTES`** (`src/proxy.ts` — currently missing, so signed-out visitors bounce to `/login` first; the card's `needsAuth` branch is dead in prod). |
| `/admin/analytics` | `src/app/admin/analytics/page.tsx` | **DECIDE (D3)** | GAP-19. `isAdmin`-gated, `notFound()` otherwise; Samuel's only launch-funnel view (conversion_events, MRR). Recommend **KEEP** — it is server-rendered, invisible to users, and its data sources are server-side. |
| `/admin/health` | `src/app/admin/health/page.tsx` | **DECIDE (D3)** | Same. Only system-health view (alerts, external API health, MCP health). Recommend **KEEP**. |

Plus the root layout `src/app/layout.tsx` — **KEEP-PUBLIC** (OG/Twitter
metadata, `metadataBase`, favicons, fonts — GAP-18). The Phase-4 sweep deletes
the `[workspaceSlug]` tree, **not** the root layout. `LayoutShell`
(`src/shared/layout/layout-shell.tsx`) stays — it dresses the kept
non-workspace routes.

### 1.2 Page routes — workspace app tree (17 under `src/app/[workspaceSlug]/(app)/`)

All **RETIRE**. Replacement: the SPA's identical route table
(`apps/desktop-ui/src/routes.tsx:49-66` — all 16 workspace pages have real
elements; nothing is a placeholder anymore, channels included). Inbound
requests after retirement: middleware 302 → retired page (§2.1), except
`.../canvas?billing=*` → 302 to the new billing surface (§2.3).

| Route(s) | Replacement in SPA |
|---|---|
| `(app)/page.tsx` (root redirect) | `routes.tsx:84-87` index → canvas |
| `canvas`, `canvas2` | `pages/canvas/index.tsx`, `canvas2.tsx` |
| `ontology`, `ontology/[clusterSlug]` | `pages/ontology/{index,detail}.tsx` |
| `knowledge`, `knowledge/[kbSlug]` | `pages/knowledge/{index,detail}.tsx` |
| `skills`, `skills/[skillSlug]` | `pages/skills/{index,detail}.tsx` |
| `workflows`, `workflows/[workflowSlug]` | `pages/workflows/{index,detail}.tsx` |
| `chats` | `pages/chats/index.tsx` |
| `channels` | `pages/channels/index.tsx` (GAP-16's port half — done) |
| `members` | `pages/members/index.tsx` |
| `settings` | `pages/settings/index.tsx` + desktop settings modal (billing pane, account actions) |
| `configuration` | `pages/configuration/index.tsx` |
| `overview` | `pages/overview/index.tsx` |
| `(app)/layout.tsx`, `error.tsx`, 5 × `loading.tsx` | SPA `AppShellLayout` (mounts `TourProviderCore`, `JoinRequestNoticesCore`, `ConnectAgentBanner`, `WelcomePopup` — GAP-3/7 closed, verified `apps/desktop-ui/src/components/app-shell/app-shell.tsx:166-178`) |

**Caveat that gates the whole table:** the web `settings`/`canvas` pages carry
the settings **modal**, which is the desktop's browser-side billing + account
deletion + workspace-icon-upload surface. The tree is deletable only after the
§2.3 replacement page exists.

### 1.3 API routes — all KEEP-CRITICAL (128 `route.ts` under `src/app/api` + rewrites)

The server is not being retired; every `/api/**` route stays. Named because
retirement touches them:

| Surface | Why it must survive |
|---|---|
| `/api/mcp` + `/api/oauth/{register,authorize,token,revoke}` + `/api/oauth-{authorization-server,protected-resource}` + `/.well-known/oauth-*` rewrites (`next.config.ts`) | Remote MCP + OAuth AS. Standing directive. |
| `/api/billing/webhook` (Stripe signature), `/api/billing/{checkout,portal,status,upgrade-to-team}` | Revenue. Webhook URL is configured in Stripe dashboard — unchanged by retirement. |
| `/api/cron/{purge-trash,oauth-cleanup,reconcile-seats}` + `vercel.json` crons (04:00/05:30/06:00) | Scheduled jobs, `CRON_SECRET`-authed. |
| `/api/version` | The min-version gate's server half (`min-version-gate` branch). The gate is a **hard dependency of retirement** (§3.1). |
| `/api/auth/mcp-device-token`, `/api/workspaces/invitations/[token]` (public GET), `/api/join/[token]` | Desktop device-token mint; invite preview; join request. |
| `/auth/callback` (route handler) | See §1.1. |
| Everything else (~110 workspace/content routes) | The SPA's entire data plane rides them via bridge → main → HTTPS. |

### 1.4 Supporting surfaces

| Surface | State | Class |
|---|---|---|
| Sitemap / robots | **None exist** (no `sitemap.ts`/`robots.ts`/static files). | n/a — optional post-cutover improvement for the landing page; not retirement work. |
| OG images | `public/img/site_thumbnail.png` + metadata in root layout | KEEP-PUBLIC |
| Favicons / webmanifest | `public/favicons/*` | KEEP-PUBLIC |
| Middleware | `src/proxy.ts` (session gate, PUBLIC_ROUTES, login-bounce breaker, bearer passthrough) | KEEP-CRITICAL — and it is the retirement **mechanism** (§2) |
| `dopl://` protocol | `main/index.js:271-272` registers it; **the only verb is `auth`** — `openDeepLink` drops any fragment `captureFromFragment` rejects. No `dopl://join|invite|billing` exists. | See §2.5 |

---

## 2. Retirement mechanism

### 2.1 Soft cutover: middleware redirect behind an env flag (recommended)

Add a `WEBSITE_RETIRED=1` check to `src/proxy.ts` (read per-request, like the
version floor — `desktop-floor.ts`'s env-not-DB rationale applies verbatim).
When set, requests to retired page routes get a 302:

- `/{segment}/(canvas|canvas2)?billing=*` → **new billing surface** (§2.3), segment preserved.
- `/canvas?billing=*` (top-level, Stripe returns + 402 envelopes already in the wild) → new billing surface via default-workspace resolution (the billing page inherits `/canvas`'s `ensureDefaultWorkspace` + query-forwarding job).
- Every other `/{segment}/*` app route, `/onboarding`, bare `/canvas` → **`/retired`** (§2.2).
- Nothing else changes: KEEP routes, `/api/**`, PUBLIC_ROUTES, the login-bounce breaker all behave as today.

Why middleware and not page deletion first: one env flip is the rollback
(minutes, no deploy of code), the redirect map is exactly one function, and the
pages stay in the tree as the escape hatch until Stage D. Hard-deleting first
would make every rollback a git revert + redeploy.

**Not 410, not hard 404.** These URLs were session-gated their whole lives —
signed-out visitors were always bounced to `/login`, so search engines never
indexed them and there is no SEO debt to pay down with a 410. A 302 to a
friendly page is strictly better for the two real inbound populations:
bookmarks and pre-1.8 wrappers.

### 2.2 The `/retired` page (new, tiny, KEEP-PUBLIC)

One static page, marketing-chrome styling, three jobs:

1. **Copy:** "Dopl now lives in the desktop app. Your workspaces and data are
   intact — everything is waiting in the app." Download button
   (`DOWNLOAD_URL`), plus "Already installed? Open Dopl" (§2.5).
2. **Dual audience:** the same page is what a **pre-1.8 remote wrapper**
   renders inside its Electron window when it `loadURL`s `HOME_URL`
   (`/canvas`) — the wrapper strips its Electron UA tokens
   (`main/index.js:293-299`) so it cannot be UA-detected; the copy must read
   correctly as an in-app "please update" screen too ("Update Dopl" ≈
   re-download the DMG). This is the *entire* forced-upgrade story for
   builds that predate the gate — acceptable, per the gate's own design note
   ("builds <= 1.8.0 do not have this code at all", `main/min-version.js`).
3. **Sessions are NOT cleared.** The kept billing/account surface and `/login`
   need the `sb-*` cookies. Offer a "Sign out" link for shared machines;
   never auto-clear. The `dopl-login-bounces` counter cookie machinery in
   `proxy.ts` stays as-is.

### 2.3 The billing/account replacement surface (new, KEEP-CRITICAL) — **D1, the big decision**

What it must absorb (all verified live today):

| Current dependency on the web canvas page | Site |
|---|---|
| Desktop "Upgrade" opens `/{segment}/canvas?billing=upgrade` in browser | `apps/desktop-ui/src/lib/open-in-browser.ts:37` (`billingPath`) |
| Desktop "Delete account in browser" opens `/{segment}/canvas` | `apps/desktop-ui/src/components/settings-modal/account-actions.tsx:46` |
| Stripe checkout `return_url` = `/canvas?billing=success&session_id=…` | `src/features/billing/server/stripe.ts:112` |
| Stripe portal `return_url` = `/canvas?billing=return` | `stripe.ts:145` |
| 402/403 envelopes `upgrade_url` = `/canvas?billing=upgrade` | `src/features/billing/server/entitlements.ts:158-160`, `src/features/chats/server/retention.ts:54` |
| Workspace icon upload (multipart) lives only in the web settings modal | `src/shared/layout/settings-modal/workspace-icon-uploader.tsx` (GAP-21) |

**Recommended shape (option a): a dedicated `/billing/[workspaceSegment]` page**
that renders `PlansBilling` + `EmbeddedCheckoutForm` + the account pane
(delete-account) + the icon uploader — i.e., the four settings-modal sections
that cannot run under the SPA's CSP or JSON-only bridge — with none of the
canvas/graph tree. All components exist and are client components already; the
page is an assembly job, not new product. Then repoint the six rows above
(4 URL builders + 2 desktop strings) at it. Stripe's `ui_mode: "elements"`
embedded checkout survives unchanged.

Alternatives for D1: **(b)** Stripe-hosted Checkout opened `openExternal` with a
`dopl://billing` return verb — kills the last product-shaped web page entirely
but changes the checkout product surface and needs a new deep-link verb + main
poll of `/api/billing/status`; **(c)** keep `/{segment}/canvas` alive as the
billing landing — rejected: it keeps the entire app tree, its layout, and the
graph engine deployed forever to serve a modal.

### 2.4 Repoint the auth-flow tails

- `safeRedirect` fallback (`src/shared/lib/url/safe-redirect.ts:30`): `/canvas`
  → the retired page (or `/billing/...` — decide with D1's naming).
- `/auth/callback` browser path: new-user onboarding detour
  (`route.ts:62-63` → `/onboarding`) and the default `/canvas` landing both
  retire → non-desktop sign-ins land on `/retired` (with the session set, so
  a subsequent "Open Dopl"/billing hop works). Desktop path (`?desktop=1`)
  unchanged.
- `main/config.js` `HOME_URL` stays `/canvas` for shipped builds (can't be
  changed retroactively) — the middleware redirect covers them; new releases
  should stop exporting it once the remote shell is deleted (Stage D).

### 2.5 "Open the app" from the web, and deep links into retired canvas URLs

There is **no** general-purpose deep link: the `dopl://` handler adopts auth
fragments and nothing else (`main/index.js:203-246` — a rejected fragment
returns before `showMainWindow()`). Two consequences:

1. Old canvas bookmarks **cannot** be translated into in-app locations today.
   Do not build per-route deep links for retirement — the retired page +
   the app's own last-location restore is enough. (If wanted later:
   a `dopl://open/{segment}/{page}` verb routed through
   `shellHelpers.navigateTo` is a ~30-line main-process addition; the SPA
   side already exists — `'dopl:navigate'` bridge events, `shell-mode.js`.)
2. The `/retired` page's "Open Dopl" link should use a plain `dopl://open`
   href: macOS launches/focuses the app on protocol activation even when the
   fragment is ignored; recommend adding the trivial `open` verb (show window,
   nothing else) in the same release as the gate so the link is a first-class
   no-op rather than an accidental one.

---

## 3. Dependency gates — what must be true BEFORE the env flip

### 3.1 The min-version gate (in flight on this branch) — merged, released, exercised

Ground truth from the `min-version-gate` diff (3 commits, +2,528 lines):

- **Server half:** `GET /api/version` serves `{ minSupported, latest }` from
  env (`DOPL_DESKTOP_MIN_VERSION`, clamped by `DOPL_DESKTOP_LATEST_VERSION`;
  malformed/above-latest floors are refused → fail-open;
  `src/shared/version/desktop-floor.ts`). Unauthenticated, uncached, always 200.
- **Client half:** `main/version-gate.js` pulls at boot + the updater's 4h
  cadence + wake-from-sleep (`main/wake.js`); a below-floor verdict swaps the
  shell for `update-required-window` via the single `createShellWindow` chokepoint
  (`main/shell-mode.js`) and drives the existing updater. Fail-open on every
  network/parse failure; DEGRADED (warn-only) when the updater has genuinely
  found nothing newer; quit always works; no floor is cached to disk.
- **Deliberately NOT a 426 on `/api/**`** — `src/shared/auth/app-version-header.ts`
  records why; do not re-litigate at cutover.

Gate checklist before Stage B:
1. Branch merged; desktop **1.8.3** (first gate-aware build) released,
   notarized (`npm run release` / `finish-notarize.sh`), and verified
   auto-updating from 1.8.2.
2. Vercel envs: `DOPL_DESKTOP_LATEST_VERSION` set as part of the release
   ritual (it is the anti-brick clamp); `DOPL_DESKTOP_MIN_VERSION` **unset**
   until Stage C.
3. One dogfood pass with `DOPL_VERSION_GATE=force` (synthesized floor) on
   Samuel's machine — the block screen, Update now, restart, release.

### 3.2 Population reality — who is on what, and what breaks for them

| Cohort | Shell | At cutover | Forced forward by |
|---|---|---|---|
| ≥ 1.8.3 (gate-aware) | SPA | Nothing changes | The floor, whenever raised |
| 1.8.0–1.8.2 | SPA, no gate | App keeps working (API/realtime untouched). Browser-side billing clicks hit `/{seg}/canvas?billing=upgrade` → **covered by the §2.1 billing redirect**. Never sees a floor. | electron-updater's normal 4h auto-update (installs on quit) — adequate; verify via release download counts before Stage D |
| < 1.8.0 (remote wrappers) | `loadURL(usedopl.com)` | Every app page → `/retired` (renders inside their window as an update screen). Tray/agent/listener half keeps working — it talks to the API, not the pages. Sign-in (`/auth/desktop-start`) still works. | The `/retired` copy + eventual auto-update; they cannot be gated (pre-gate code) |

**Pre-flip check (Samuel):** confirm the pre-1.8 population is ~zero or known.
Cheapest signal already in the DB: `X-Dopl-App-Version` stamps on recent
channel messages / `mcp_events`, or device-token `last_used_at` by client.
If a meaningful pre-1.8 cohort exists, hold Stage B until auto-update has
drained it — the `/retired`-inside-Electron experience is survivable but ugly.

### 3.3 Journey-audit disposition — all 23 gaps

**Closed in code since the audit (verified this pass):**

| Gap | Verdict |
|---|---|
| GAP-1 signed-out view | **Closed** — `pages/boot/signed-out-screen.tsx` = the web `/login` via `LoginFormCore`; sign-out is `spaSignOut` (`shell-mode.js`), no remote load |
| GAP-2 Google-only sign-in | **Closed** — password + magic link over the bridge in main (`auth-password.js`); OAuth `?provider=` param; `state` nonce echoed end-to-end (I3 residual also closed) |
| GAP-3 / GAP-7 shell guidance + join notices | **Closed** — all four mounted in SPA `app-shell.tsx:166-178` |
| GAP-5 / GAP-12 `file:///` URLs | **Closed** — `getAppOrigin()` seam (`src/shared/lib/app-origin.ts`) used by invite-dialog + all five MCP-connect surfaces |
| GAP-14 (desktop half) magic link | **Closed** — desktop magic links `redirect_to` `/auth/desktop-handoff` directly |
| GAP-16 notification click-through | **Closed** — `navigateToChannels` routes over the bridge in SPA mode; channels page is real |
| GAP-20 avatars/icons under CSP | **Closed** — `img-src` pins the Supabase storage origin; avatars ride the bridged data-URI proxy (`use-bridged-image-src`, `avatar-policy.js`) |
| GAP-11 `upgrade_url` → `/pricing` | **Half-closed** — now points at `/canvas?billing=upgrade` (`entitlements.ts`), which **this plan retires**; final repoint to the D1 surface is Stage A work |

**Closed by this plan's KEEP list (no code):** GAP-8 (`/auth/reset-password`
KEEP), GAP-17 (`/terms`+`/privacy` KEEP), GAP-18 (root layout KEEP), GAP-6
(`/join` KEEP as bounce + PUBLIC_ROUTES fix), GAP-22 (`desktop-complete`
retires with the remote shell, Stage D).

**Blocking Stage B (need work or a decision):**

| Gap | What remains | Owner |
|---|---|---|
| GAP-9/10 billing in SPA | The D1 surface + the 6 repoints (§2.3). The desktop billing pane itself is done (`billing-pane.tsx` — portal via `openUrlInBrowser`, checkout via browser). | build + **D1** |
| GAP-13 account deletion | Same surface (delete-account section), or port to SPA later (**D4**) | build + D4 |
| GAP-21 icon upload | Fold into the D1 surface (recommended) or accept loss / port multipart over the bridge (**D4**) | D4 |
| GAP-4 `/invite/[token]` | **D2** — retire vs bounce | Samuel |
| GAP-19 `/admin/*` | **D3** — keep (recommended) | Samuel |
| GAP-15 Supabase Site URL | Dashboard audit: Site URL + Additional Redirect URLs must include `/auth/callback` and `/auth/desktop-handoff`; re-check after any default-landing change | ops checklist, Stage A |

**Non-blocking (note-and-move-on):** GAP-14 browser half (a browser magic-link
session lands on `/retired` with a session — acceptable), GAP-23 (arm64-only
DMG — landing-page accuracy problem, pre-existing, not retirement-coupled).

### 3.4 Remaining gates (from the master plan)

- **Channels smoke test** before the flip (send/receive, consent
  request+decide, roster pills, two windows) — the standing guardrail.
- **DB backup** per the plan's protocol + git tag `pre-website-retirement-<date>`.
- **Notarized release** carrying the gate + the `dopl://open` verb (§2.5).
- Vercel env dry-run: `WEBSITE_RETIRED` flag deployed **off** first (Stage A),
  flipped separately (Stage B) — the flip must not be coupled to a code deploy.

---

## 4. Sequencing

**Stage A — prep (no user-visible change).**
Merge `min-version-gate`; ship 1.8.3 (gate + `dopl://open`); build `/retired`
+ the D1 billing/account page; repoint `billingPath`, `account-actions`,
`upgradeUrl()`, both Stripe `return_url`s, `safeRedirect` fallback, callback
landings; add `/join/` to `PUBLIC_ROUTES`; land the `WEBSITE_RETIRED`
middleware branch (off); Supabase dashboard audit (GAP-15); backups + tag.
*Rollback: n/a — everything is additive.*

**Stage B — soft cutover (one env flip).**
Set `WEBSITE_RETIRED=1`. Logged-in web users get `/retired`; billing traffic
reroutes to the new surface; desktop users notice nothing. Watch: Stripe
webhook deliveries, `/api/billing/checkout` success rate, `admin/health`,
Vercel logs for redirect-loop anomalies, support channels.
*Rollback: unset the env — minutes, no deploy.*

**Stage C — force the floor (after B is quiet, ~1–2 weeks).**
Set `DOPL_DESKTOP_MIN_VERSION=1.8.3` (or current) with
`DOPL_DESKTOP_LATEST_VERSION` current. Gate-aware builds below the floor block
and update; 1.8.0–1.8.2 drain via auto-update; pre-1.8 wrappers live on the
`/retired` screen. *Rollback: lower/unset the floor. The server refuses
fleet-bricking floors by construction.*

**Stage D — hard delete (after C is stable, ≥2–4 weeks of quiet).**
One PR deletes the web app tree + web-only bindings (§5); a paired desktop
release deletes the remote shell (`createMainWindow` path, `load-guard.js`,
`auth-cookies.js`, cookie halves of `auth-state.js`, `version-skew.js`,
`DOPL_UI=remote`), then `/auth/desktop-complete` goes too. **Order matters:
deleting the web pages kills the remote rollback path anyway — so the two
deletions belong together, and only once rolling back to the remote shell is
something you would never do.** Middleware redirects for retired URLs stay
(they are now the 404 handler for bookmarks).
*Rollback: git revert + redeploy — real work; that is why D waits.*

**Stage E — cleanup (unscheduled).**
Drop `/api/**` from the middleware matcher (auth-flows §6.5's end state); knip
pass over newly-dead exports; `ENGINEERING.md` / `REFACTOR-FINDINGS.md` /
Dopl KB sync per the session-end ritual; optional landing sitemap/robots.

---

## 5. Code deletion scope (Stage D)

### 5.1 The SPA-import boundary — the rule that governs every deletion

The SPA aliases `@/` to the **repo-root web tree** (`apps/desktop-ui/vite.config.ts`,
`tsconfig.json:paths`) and reuses web modules by direct import. Ground truth
measured from the shipped bundle's sourcemaps (built 2026-08-03, in
`dopl-desktop-app/renderer/app/assets/*.map`): **312 web-tree modules under
`src/` are compiled into the SPA** — the full list is reproducible via the
sourcemap extraction and the per-directory shape is:

`features/channels` 50 · `knowledge` 35 · `ontology` 27 · `members` 24 ·
`workflows` 19 · `chats` 11 · `configuration` 11 · `skills` 11 ·
`onboarding` 9 · `workspaces` 8 · `mcp-connect` 6 · `billing` 5 · `auth` 4 ·
`tour` 4 · plus `shared/{ui 19, layout 16, lib 14, design 8, graph 8, hooks 6,
realtime 4, api 3, auth 2, editor 3, supabase 1}` and `features/marketing/constants.ts`
(the SPA imports `DOWNLOAD_URL`).

**The sourcemap list is necessary but NOT sufficient.** Two classes of
SPA-imported files never appear in JS sourcemaps and are deletion traps:

1. **Type-only imports** (erased at build): `src/features/{members,channels,
   chats,ontology,skills,teams,workspaces}/types.ts`,
   `features/knowledge/components/knowledge-v2/types.ts`,
   `shared/layout/app-shell/workspace-types.ts`, `shared/ui/link-like.ts` —
   all are `import`ed from `apps/desktop-ui/src` (grep-verified) yet absent
   from the maps.
2. **CSS modules** bundled into the CSS artifact:
   `shared/layout/app-shell/app-shell.module.css` is SPA-imported.

**Therefore the deletion fence is mechanical, not list-based:** every deletion
PR must pass (i) `apps/desktop-ui` `vite build` + `tsc --noEmit` (an
unresolvable `@/` import fails loudly — this guard was designed in, see the
vite config comment), (ii) root `next build` + `tsc --noEmit`, (iii) the SPA
vitest suite. The existing eslint fence already refuses `@/app/*` imports from
the SPA, so nothing under `src/app/` is ever SPA-reachable — the entire
`src/app/[workspaceSlug]` tree is provably safe to delete.

### 5.2 What dies (web)

| Tree | LOC (measured) | Notes |
|---|---|---|
| `src/app/[workspaceSlug]/**` (17 pages + layout + error + 5 loading) | 1,036 | Provably SPA-unreachable (eslint fence) |
| `src/app/{canvas,onboarding}/page.tsx` | 81 | After §2.4 repoints |
| `src/app/invite/[token]/` + `accept-invite-card.tsx` | ~200 | If D2 = retire |
| `src/app/auth/desktop-complete/page.tsx` | 101 | With the remote shell |
| Web-only full bindings whose `-core` twins the SPA uses: `app-shell.tsx`, `app-rail.tsx`, `app-sidebar.tsx`, `workspace-switcher.tsx`, `settings-modal.tsx` + sections (`plans-billing.tsx`, `delete-account.tsx`, `account-section.tsx`, `workspace-section.tsx`) + `workspace-icon-uploader.tsx`, `tour-provider.tsx`, `onboarding-flow.tsx`, `channels-view.tsx`, `channels-onboarding.tsx`, `skills-browser.tsx`, `members-widget.tsx`, `overview-stats.tsx`, `create-workspace-dialog.tsx`, `join-request-notices.tsx`, `workspace-danger-zone.tsx`, `workspace-settings-form.tsx`, `landing-preview.tsx`, `use-auth-user.ts`, `use-login.ts` | ~1,900 | **Each individually conditional on the build fence** — some are consumed by the kept `/login`, `/oauth/authorize`, D1 and D2/D3 pages (e.g. `use-login.ts`, `login-screen.tsx`, `google-one-tap.tsx`, `layout-shell.tsx`, `plans-billing.tsx` stay if D1 = option (a)); the fence, not this table, is the authority |
| Assorted: `settings-modal.module.css`, `tour.module.css`, `knowledge-v2.module.css` (if unused by kept pages), `idb-persister.ts`, feature `index.ts` barrels | ~200 | knip pass |

Estimated web-side removal: **~3,000–3,500 LOC** (less if D1 keeps the
settings-modal billing sections alive; the modal shell itself still dies).

**What explicitly does NOT die:** every `src/features/*/server/**` and
`src/shared/{auth,api,supabase}` server module (the API), all marketing
components (landing), auth components for kept pages, all 312 bundle modules +
the type/CSS trap files, `src/proxy.ts`, `src/app/layout.tsx`.

### 5.3 What dies (desktop, paired release)

| Module | LOC | Notes |
|---|---|---|
| `main/load-guard.js` | 252 | Remote-URL recovery — inert in SPA mode already |
| `main/auth-cookies.js` | 214 | The cookie jar transport (auth-flows §4 table) |
| `main/version-skew.js` | 166 | Superseded by the real gate |
| Remote branches: `createMainWindow` factory, `!isSpaMode()` paths in `index.js`/`shell-mode.js`/`auth-actions.js` (`HOME_URL` load), cookie halves of `auth-state.js` (`rebuildBlobFromCookieSession`, probes), `desktop-complete` load | ~300–400 | Follow auth-flows.md §4's consumer table; carry its I1–I12 invariants forward |

Estimated desktop-side removal: **~900–1,000 LOC** plus their tests
(`test/auth-signed-in`, `tray-auth`, etc. rewrites — auth-flows §4.7).

---

## 6. Risks and unknowns

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Stripe returns in flight at the flip** — a checkout opened pre-flip returns to `/canvas?billing=success` | The §2.1 billing-aware redirect preserves the query; keep it forever |
| R2 | **Stripe dashboard config** — portal default return URL / branding URLs may be set dashboard-side, invisible to this repo | Stage-A checklist: audit Stripe dashboard (portal configuration, receipt/branding URLs) |
| R3 | **Supabase dashboard config** (GAP-15) — Site URL backs provider-confirm emails; Additional Redirect URLs allowlist | Stage-A checklist; re-audit after callback repoints |
| R4 | **Recovery/magic-link emails in flight** — Supabase links are short-lived (hours); all land on kept surfaces (`/auth/callback`, `/auth/reset-password`) | None needed — covered by KEEP list |
| R5 | **No Dopl-sent transactional email exists** (`invitations.ts:58-61`, repo-wide) — nothing else embeds URLs | Verified; join links are the only durable in-the-wild URLs (§1.1 `/join`) |
| R6 | **SEO** — kept pages unchanged; app pages were never indexable (session gate) | No action; optional sitemap later |
| R7 | **OAuth provider allowlists** — Google/GitHub redirect to Supabase (`*.supabase.co`), not us; MCP OAuth clients' `redirect_uri`s are client-registered and the AS surface is kept | No action |
| R8 | **Pre-1.8 wrappers see `/retired` inside the app window** with no version-targeted messaging (UA is scrubbed, `main/index.js:293-299`) | Accept; copy written for dual audience (§2.2). Optionally: wrapper page loads could be detected via a `?src=app` on `HOME_URL` — but shipped builds can't be changed; don't bother |
| R9 | **1.8.0–1.8.2 cohort never sees a floor** (no gate code) | electron-updater auto-drains on quit; verify before Stage D via release stats / `X-Dopl-App-Version` stamps |
| R10 | **The D1 page inherits the settings-modal's session requirement** — a desktop user's browser may be signed out | Works today: middleware bounces `/billing/...` → `/login?redirectTo=` → back. `/login` is KEEP. Verify once in Stage A |
| R11 | **`resolvePageWorkspace` 301-canonicalization dies with the pages** — legacy-slug web URLs stop redirecting | Irrelevant post-retirement: the API twin (`resolveApiWorkspace`) keeps accepting legacy slugs; SPA handles canonicalization client-side |
| R12 | **Admin pages ride app-tree CSS/tokens** — deleting the app tree could break `/admin/*` styling | They use global token classes; include `/admin/*` render check in the Stage-D PR |
| R13 | **Deleting `use-auth-user.ts` etc. breaks kept pages** — the "full binding" list in §5.2 overlaps kept-page imports | The build fence (§5.1) is the authority; delete in small batches, build after each |
| R14 | **arm64-only DMG** (GAP-23) — the retired page becomes the most-seen download surface | Pre-existing; note on the landing copy; not a retirement blocker |

---

## 7. Samuel decisions (explicit)

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Browser billing/account surface | (a) dedicated `/billing/[segment]` page assembling the existing modal sections; (b) Stripe-hosted Checkout + `dopl://billing` verb + status poll; (c) keep `/{segment}/canvas` alive | **(a)** — assembly of shipped components, keeps embedded checkout, unblocks deleting the whole app tree. (b) is the better end-state if you want *zero* product-shaped web pages; it is more work and a checkout-UX change |
| **D2** | `/invite/[token]` + the invitation-token URL | retire page + rely on in-app pending invites (invites are email-matched in-app; no email ever carries the URL) · keep a minimal bounce | **Retire.** The URL has no legitimate producer; `/join` covers link sharing |
| **D3** | `/admin/analytics`, `/admin/health` | keep · move to Ops OS · delete | **Keep** — server-rendered, admin-gated, only funnel/health views; costs nothing |
| **D4** | Account deletion + icon upload long-term home | stay on the D1 web surface · port into SPA (delete = `DELETE /api/user/delete` over bridge; icon = multipart over a new bridge op) | **Stay on D1 surface now**; port later if the web surface ever fully dies (D1=b) |
| **D5** | Cutover pacing | when to flip `WEBSITE_RETIRED`; floor value + raise cadence; quiet period before Stage D; when the remote-shell rollback path is worth less than its carrying cost | Proposed: A now → B after 1.8.3 saturates (~1–2 wk) → C +1–2 wk → D +2–4 wk |
| D6 (minor) | `/pricing` | keep as page · fold into landing modal | Keep (18 lines) |
| D7 (minor) | Browser sign-ins post-retirement (`/auth/callback` non-desktop) | land on `/retired` · land on D1 billing page | `/retired` with session preserved |

---

## Appendix: verification commands used

- Route census: `find src/app -name page.tsx -o -name route.ts` (17 top-level
  pages + 17 workspace pages + 128 API routes + callback route).
- SPA bundle ground truth: parse `dopl-desktop-app/renderer/app/assets/*.js.map`
  `sources`, resolve against the assets dir, partition `src/` vs
  `apps/desktop-ui/src/` (312 vs 38 modules).
- Gate ground truth: `git diff master...min-version-gate --stat` (+2,528 lines,
  20 files) and direct reads of `version-gate.js`, `min-version.js`,
  `desktop-floor.ts`, `api/version/route.ts`, `shell-mode.js`, `wake.js`.
