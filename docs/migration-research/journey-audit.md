# Journey audit — every user journey, end to end, after website retirement

Companion to [web-pages.md](./web-pages.md) (which audits **code per page**) and
[auth-flows.md](./auth-flows.md) (which audits **credentials**). This doc audits
**user journeys**: for each step a real person takes, where does that step happen
after the website's content pages die?

The `/onboarding` miss (fixed in DESKTOP-MIGRATION-PLAN.md commit `10409d4`) was
found because nobody had walked a journey end-to-end. This is that walk.

**Method:** every step traced to real code. No speculation. Citations are
`path:line`; desktop paths are under `dopl-desktop-app/`.

**Status legend:**
- **OK** — the surface survives (KEEP list) or is already ported.
- **tracked** — broken today, but a named plan/research item covers it.
- **GAP** — nothing in the plan, the research docs, or the code covers it.

**Baseline facts this audit rests on:**

| Fact | Evidence |
|---|---|
| The SPA route table has no login, onboarding, invite, join, billing-return or signed-out route, by design | `apps/desktop-ui/src/routes.tsx:24-26` |
| The SPA window refuses **all** navigation off its local `file:` document | `dopl-desktop-app/main/spa-window.js` `isAllowedNavigation` |
| The packaged renderer CSP is `default-src 'none'; script-src 'self'; connect-src 'none'; frame-src 'none'; img-src 'self' data: blob:` | `apps/desktop-ui/vite.config.ts:26-36` |
| **Dopl sends no transactional email of its own.** No Resend/Postmark/SendGrid/SMTP anywhere. Invitations explicitly say "no email send is wired" | `src/features/workspaces/server/invitations.ts:58-61`; repo-wide grep |
| Every email a user receives is a **Supabase Auth** email (magic link, recovery, provider confirm), and every one embeds `${NEXT_PUBLIC_APP_URL}/auth/callback?...` | `src/features/auth/hooks/use-login.ts:17-19,90,104,118` |
| The SPA renderer has no Supabase client (it throws by design) and no realtime | `src/shared/supabase/browser.ts` (SPA branch), `src/shared/realtime/shared-channel-registry.ts` (SPA no-op) |

---

## J1 — New user: discover → download → sign up → onboard → first workspace

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Discovers product | `/` marketing landing (`src/app/page.tsx`) → `SiteNav` + `Hero` | Plan Phase 4: "web app routes → download page". Landing must survive in **some** form because it hosts the only download link. | tracked |
| 2 | Downloads | `DOWNLOAD_URL` = `https://github.com/SamuelrWang/Dopl/releases/latest/download/Dopl-arm64.dmg` (`src/features/marketing/constants.ts:24`) | GitHub-hosted; survives. **arm64 only** — no Intel/Windows asset. | OK |
| 3 | Launches app, clicks sign in | Today: the app `loadURL`s the remote `/login` page, whose Google button calls `window.open('${origin}/auth/desktop-start')` (`use-login.ts:131-133`). Tray also has `beginSignIn` → `shell.openExternal(${APP_ORIGIN}/auth/desktop-start)` (`main/auth-actions.js:18,67-69`). | **The SPA has no sign-in button and no signed-out view.** `apps/desktop-ui/src/routes.tsx` has no `/login` route; `app.tsx` mounts the router unconditionally; `AppShellLayout` renders `PageLoading`/`PageError` on an unauthenticated boot, not a sign-in CTA. Only the **tray** menu can start sign-in. | **GAP-1** |
| 4 | OAuth runs in system browser | `/auth/desktop-start` → `signInWithOAuth({ provider: "google" })` (`src/app/auth/desktop-start/page.tsx:20-22`) | Page is on the KEEP list. But it is **hardcoded to Google**. Email+password, magic link and GitHub — all offered on `/login` (`use-login.ts:90,104,140`) — have **no desktop handoff**. Once `/login` stops being reachable in-app, every non-Google account is locked out and no one can sign up with email. | **GAP-2** |
| 5 | Callback | `/auth/callback?desktop=1` → exchange, log `signup` event, `ensureDefaultWorkspace`, **skip the onboarding detour** (`src/app/auth/callback/route.ts:21,31,51,56`) | KEEP. The skip is deliberate: "the user finishes onboarding inside the app". | OK |
| 6 | Handoff | `/auth/desktop-handoff` → `dopl://auth#tokens` (`src/app/auth/desktop-handoff/page.tsx`) → `auth.captureFromFragment` (`main/auth.js:75`) | KEEP. | OK |
| 7 | App adopts session | `openDeepLink` loads `${APP_ORIGIN}/auth/desktop-complete#…` into the main window (`main/index.js:215-218`) | With the SPA window, that `loadURL` is **refused** by `isAllowedNavigation`. auth-flows.md §3.2 item 6 already says `desktop-complete` is *deleted*, not replaced — but `main/index.js:215-218` still points at it and WIRING.md's integration list does not mention it. | tracked (auth-flows §3.2) — but the code change is unlisted in WIRING.md |
| 8 | Onboarding (survey → MCP connect → workspace naming) | `/onboarding` (`src/app/onboarding/page.tsx`) → `OnboardingFlow` (survey-step, mcp-connect-step, workspace-name-step) | Plan Phase 4 now says "port as its own slice". Not in `routes.tsx`. `GET /api/user/onboarding-state` exists (`src/app/api/user/onboarding-state/route.ts`) but nothing calls it. | tracked |
| 9 | Lands in first workspace | `/canvas` boot page resolves default workspace (`src/app/canvas/page.tsx:30-42`) | `POST /api/workspaces/ensure-default` exists. The SPA's `/` route is still a **placeholder** that says "Workspace resolution is not ported yet" (`apps/desktop-ui/src/routes.tsx:89-96`). | tracked (G2) |
| 10 | Welcome popup + product tour | `WelcomePopup` (localStorage `dopl:welcome`, set by onboarding) + `TourProvider`, both mounted by the web layout | **Neither is mounted in the SPA shell** (`apps/desktop-ui/src/components/app-shell/app-shell.tsx` — no `WelcomePopup`, no `TourProvider`, no `ConnectAgentBanner`). A new user gets no first-run guidance at all. | **GAP-3** |

---

## J2 — Invited user (email invitation → `/invite/[token]`)

**The controlling fact: no invitation email is ever sent.** `createInvitation`
(`src/features/workspaces/server/invitations.ts:58-61`) records the invite and
its comment states the invitee discovers it "in the sidebar (email-matched) —
no email send is wired." So `/invite/[token]` is only reachable if an admin
manually copies the URL out of the address bar — there is no UI that surfaces
the invite token at all (`invite-dialog.tsx` only exposes the *join link*, not
the invitation token).

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Admin invites by email | `InviteDialog` → `POST /api/workspaces/{slug}/invitations` (`invite-dialog.tsx:214`) | Members page is ported (`apps/desktop-ui/src/pages/members/index.tsx` reuses `MembersView`). Works. | OK |
| 2 | Invitee is notified | **Nothing.** No email. The invite is matched by email address when the invitee next signs in. | Unchanged post-retirement — but the delivery mechanism is a web-app-side surface that must exist in the SPA (see step 4). | see GAP-4 |
| 3 | Invitee opens `/invite/{token}` (only if hand-delivered) | `src/app/invite/[token]/page.tsx` → `AcceptInviteCard`. Public route (`src/proxy.ts:26`). Signed-out branch links to `/login?redirectTo=/invite/{token}` (`accept-invite-card.tsx:117`). | Page dies. A brand-new invitee clicking it post-retirement gets a 404/redirect with **no path into the app** — no "open in Dopl" deep link, no `dopl://invite/{token}` handler (the protocol handler only understands `auth`, `main/index.js:190-215`). | **GAP-4** |
| 4 | Invitee accepts inside the app | The email-matched pending invite surfaces via the members hooks; acceptance is `POST /api/workspaces/invitations/{token}` | The SPA members page exists, but nothing in the SPA lists *the caller's own* pending invitations — that path was the web sidebar. Verify before retirement. | **GAP-4** |

---

## J3 — Workspace join links (`workspace_join_links` → `/join/[token]`)

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Admin copies the link | `InviteDialog` builds it as **`${window.location.origin}/join/${token}`** (`src/features/members/components/invite-dialog.tsx:69-72`) | In the packaged SPA `window.location.origin` is **`file://`**, so the copied link is `file:///join/<token>` — a dead string. In dev it is `http://localhost:5173/...`. **This is broken right now on the already-ported members page**, not just post-retirement. | **GAP-5** |
| 2 | Recipient opens the link | `src/app/join/[token]/page.tsx` → `JoinLinkCard`. **`/join/` is NOT in `PUBLIC_ROUTES`** (`src/proxy.ts:4-38` lists `/invite/` only), so a signed-out visitor is bounced to `/login?redirectTo=/join/…` by the middleware — the card's `needsAuth` branch (`join-link-card.tsx:88-101`) is effectively dead in prod. | Page dies. Same as J2 step 3: no deep link, no app-side landing. | **GAP-6** |
| 3 | Requests to join | `POST /api/join/{token}` → then `router.push("/canvas")` (`join-link-card.tsx:52`) | `/canvas` is the web boot route. | dies with the page |
| 4 | Admin approves | Members page join-requests pane | Ported. | OK |
| 5 | Requester learns the outcome | `JoinRequestNotices` — `GET /api/me/join-requests` + ack — mounted by the **web** app layout | **Not mounted in the SPA shell** (`apps/desktop-ui/src/components/app-shell/app-shell.tsx`). An approved joiner is never told; the join loop has no terminal step in the desktop app. | **GAP-7** |

---

## J4 — Password reset

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | "Forgot password" on `/login` | `resetPasswordForEmail(email, { redirectTo: '${authOrigin()}/auth/callback?redirectTo=/auth/reset-password' })` (`src/features/auth/hooks/use-login.ts:113-120`) | `/login` is on the KEEP list, so the trigger survives — **but only if the user can reach `/login`**, and the desktop app has no link to it (GAP-1/GAP-2). | tracked |
| 2 | Supabase sends the recovery email | Supabase Auth template → the `redirectTo` above | Survives. | OK |
| 3 | Link lands on `/auth/callback` | KEEP list ("the Supabase auth callback"). | OK | OK |
| 4 | Forwarded to `/auth/reset-password` | `src/app/auth/reset-password/page.tsx` → `ResetPasswordScreen` | **NOT on the KEEP list.** Plan Phase 4 enumerates: `/oauth/authorize`, `/.well-known/*`, token endpoints, the Supabase auth callback, `/login`, `/auth/desktop-*`. `/auth/reset-password` is absent, so the Phase-4 deletion sweep takes it — and every recovery email already in flight dead-ends. | **GAP-8** |

---

## J5 — Billing: upgrade, portal, cancel

**Checkout is embedded, not hosted.** `ui_mode: "elements"`
(`src/features/billing/server/stripe.ts:108`) renders Stripe's `PaymentElement`
*inside our own page* (`embedded-checkout.tsx`), loaded from `js.stripe.com` via
`loadStripe` (`embedded-checkout.tsx:4,14`).

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Paywall hit | `UpgradeModal` mounted from canvas (`graph-view` tree), chats `list-pane.tsx:252`, and `invite-dialog` — **all three are ported pages** | `UpgradeModal` → `EmbeddedCheckoutForm` → `loadStripe` fetches a **CDN script** and Stripe opens **iframes** and **XHR**. The packaged CSP is `script-src 'self'`, `frame-src 'none'`, `connect-src 'none'` (`apps/desktop-ui/vite.config.ts:26-36`). Checkout cannot render in the SPA — at all. | **GAP-9** |
| 2 | Pay | `checkout.confirm()` with no args, relying on the session's server-set `return_url` (`embedded-checkout.tsx:140-146`) | `return_url` = **`${appUrl}/canvas?billing=success&session_id=…`** (`stripe.ts:112`). That is a top-frame navigation to a remote https URL, which `isAllowedNavigation` refuses in the SPA window — and `/canvas` is a web page that Phase 4 deletes. Double failure. | **GAP-9** |
| 3 | Manage / cancel | `POST /api/billing/portal` then `window.location.href = data.url` (`plans-billing.tsx:96`) | Same navigation refusal. Must become `window.dopl.openExternal(url)`. Portal `return_url` = **`${appUrl}/canvas?billing=return`** (`stripe.ts:145`) — also a deleted page. | **GAP-10** |
| 4 | Post-return finalize poll | `AppShell` reads `?billing=` from `window.location.search` and strips it (`app-shell.tsx:60-82`); `PlansBilling` polls `ent.refresh()` 1 s × 20 (`plans-billing.tsx:57-70`) | The SPA is a **hash** router (`apps/desktop-ui/src/app.tsx`) — `window.location.search` is always empty. No `?billing=` handling exists in `apps/desktop-ui/src/components/app-shell/app-shell.tsx`. | **GAP-10** |
| 5 | Any billing UI at all in the SPA | Settings **modal** → `PlansBilling` pane | The SPA deliberately opens the settings **page** instead of the modal, and that page ships no billing section (`apps/desktop-ui/src/pages/settings/index.tsx` — rename form, RemoteConnect, ConnectedApps, Trash, DangerZone only). The port note explains why the modal is not portable. **There is currently no way to subscribe, view a plan, or cancel from the desktop app.** | **GAP-9** |
| 6 | Entitlement-denied envelopes | `upgrade_url: ${appUrl}/pricing` returned by the API (`src/features/billing/server/entitlements.ts:207,223`; `src/features/chats/server/retention.ts:46`) | `/pricing` is a marketing page Phase 4 deletes. Every 402 envelope then points at a 404 — and the desktop client would have to `openExternal` it anyway. | **GAP-11** |
| 7 | Stripe webhook | `POST /api/billing/webhook`, public route (`src/proxy.ts:12`) | Server-side, survives. | OK |

---

## J6 — Agent / MCP connect (Claude connector + device token)

| # | Step | Surface today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | User finds the MCP URL | `RemoteConnect`, `ConnectClients`, `AgentSkillCard`, `McpConnectStep`, `WelcomePopup` — **all five** build the URL as `${window.location.origin}/api/mcp` (`remote-connect.tsx:21-23`, `connect-clients.tsx:28-32`, `agent-skill-card.tsx:24-28`, `mcp-connect-step.tsx:27-31`, `welcome-popup.tsx:24-25`) | In the packaged renderer that resolves to **`file:///api/mcp`**. `RemoteConnect` and `ConnectedAppsSection` are already mounted on the ported settings page (`apps/desktop-ui/src/pages/settings/index.tsx:7,90`), so the app's primary "connect your agent" instructions are **wrong today**. web-pages.md §14 names this ("must come from config, not `location`") but no config seam exists. | **GAP-12** |
| 2 | Agent hits `/api/mcp` unauthenticated | Route returns its own MCP 401 + `WWW-Authenticate` pointing at the OAuth AS | Public route, KEEP. | OK |
| 3 | Discovery | `/.well-known/oauth-*`, `/api/oauth-authorization-server`, `/api/oauth-protected-resource` | KEEP. | OK |
| 4 | Consent screen | `/oauth/authorize` page, bouncing through `/login?redirectTo=…` when signed out (`src/app/oauth/authorize/page.tsx:63-72`) | KEEP — and this is exactly *why* `/login` must survive. Note the coupling: **the OAuth consent flow depends on `/login` being a working, full-featured sign-in page**, which is a second reason GAP-2 (Google-only desktop handoff) cannot be solved by shrinking `/login`. | OK |
| 5 | Token exchange / refresh / revoke | `POST /api/oauth/{register,authorize,token,revoke}` | KEEP. | OK |
| 6 | Revoking a connected app | `ConnectedAppsSection` → `GET/DELETE /api/oauth/grants` | Ported onto the settings page. | OK |
| 7 | Device token for spawned local agents | `POST/DELETE /api/auth/mcp-device-token`, both `sessionOnly`; desktop `main/mcp-config.js` | Main-process only; the Supabase-bearer decision (auth-flows §3.2) keeps the caller session-grade. | OK |

---

## J7 — Sign out, account deletion, workspace deletion

| # | Journey | End state today | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Sign out (tray) | `auth-actions.signOut()` → clear blob + jar → `load(HOME_URL)` = `${APP_ORIGIN}/canvas`, which server-redirects to `/login` (`main/auth-actions.js:71-83`) | `HOME_URL` load is refused by the SPA window, and `/canvas` is deleted. auth-flows §4.5 names the fix ("route the SPA to its signed-out view") — **but the SPA has no signed-out view** (same hole as GAP-1). | **GAP-1** |
| 2 | Sign out (in-app) | `useAuthUser().signOut()` (`src/shared/auth/use-auth-user.ts:29-31`) — Supabase browser client | The SPA renderer has no Supabase client by design. No sign-out control exists in the SPA UI. Tray only. | **GAP-1** |
| 3 | Delete account | `delete-account.tsx:20` `DELETE /api/user/delete` → clear localStorage → `supabase.auth.signOut()` → `router.push('/login')` (`:47-48`) | Lives in the settings **modal**, which the SPA does not mount; the SPA settings page has no account pane. **Account deletion is unreachable from the desktop app** — a compliance-relevant hole. | **GAP-13** |
| 4 | Delete workspace (not the last) | `WorkspaceDangerZone` → `router.push('/{nextSegment}')` | SPA settings page does this via `navigate` (`apps/desktop-ui/src/pages/settings/index.tsx:100-105`). | OK |
| 5 | Delete the **last** workspace | web: `router.push('/onboarding')` (`src/features/workspaces/components/workspace-danger-zone.tsx:24`); SPA: `navigate('/')` → the placeholder page | Known as G2 + the Phase-4 onboarding bullet. Still lands on a placeholder today. | tracked |

---

## J8 — Notifications and emails, and every URL they embed

| Sender | Trigger | Embedded URL | Post-retirement | Status |
|---|---|---|---|---|
| Supabase Auth | Magic link | `${authOrigin()}/auth/callback` (`use-login.ts:90,104`) | `/auth/callback` KEEP; but the link opens the **browser**, which then has a session and nowhere to go (no `dopl://` bounce for the non-`desktop=1` path). | **GAP-14** |
| Supabase Auth | Password recovery | `${authOrigin()}/auth/callback?redirectTo=/auth/reset-password` (`use-login.ts:116-118`) | Target page not on KEEP list. | **GAP-8** |
| Supabase Auth | Provider/email confirm | Supabase project **Site URL** (dashboard config, not in this repo) | Must be re-pointed if the site's default route changes. Not code — easy to forget. | **GAP-15** |
| Dopl | Workspace invitation | — | **No email is sent** (`invitations.ts:58-61`). | see J2 |
| Dopl | Join request / approval | — | No email; in-app `JoinRequestNotices` only. | see GAP-7 |
| Desktop OS notification | Channel message, consent request, task | `main/task-notify.js:51,96,212`, `main/trigger.js:95,206,454` → `targeting.openChannelForEntry(entry)` | See J9. | **GAP-16** |
| Desktop OS notification | Update downloaded | `main/updater.js:170-174` — in-app dialog, no URL | OK | OK |
| Desktop OS notification | Session gate / held reply | `main/session-gate.js:100-102` — opens local session window | OK | OK |

---

## J9 — Deep links and hardcoded remote URLs in the desktop main process

| # | Mechanism | Code | Post-retirement | Status |
|---|---|---|---|---|
| 1 | `dopl://auth#<tokens>` | `main/index.js:186-218`, `main/auth.js:75` | The **only** deep-link verb the app understands. There is no `dopl://invite`, `dopl://join`, or `dopl://channel`. | see GAP-4/6 |
| 2 | Deep link completion navigates to a remote page | `main/index.js:215` `${APP_ORIGIN}/auth/desktop-complete#…` | Refused by the SPA window; auth-flows §3.2 says delete it. Not listed in WIRING.md's integration steps. | tracked (unlisted) |
| 3 | **Channel notification click** | `main/index.js:144-148` `navigateToChannels(segment)` → ``loadGuard.load(`${APP_ORIGIN}/${segment}/channels`)``; registered as `openChannel` at `main/index.js:413-417`; called from `main/targeting-window.js:27-29` for every task/trigger/FYI notification | Two failures: (a) the https navigation is refused by `isAllowedNavigation`; (b) **`/channels` is not ported** (`apps/desktop-ui/src/routes.tsx:59` has no `element`). Every agent notification click becomes a no-op. This is the app's primary agent-comms affordance. | **GAP-16** |
| 4 | Sign-in launch | `${APP_ORIGIN}/auth/desktop-start` via `shell.openExternal` (`main/auth-actions.js:18,67-69`) | KEEP target, external browser — fine. | OK |
| 5 | Sign-out reload | `load(HOME_URL)` = `${APP_ORIGIN}/canvas` (`main/auth-actions.js:81`, `main/config.js:10`) | See J7-1. | **GAP-1** |
| 6 | `loadApp()` / menu "Home" | `main/index.js:150-152` `loadGuard.load(HOME_URL)` | Same. `buildMenu` wires `onHome: loadApp` (`main/index.js:180`). | **GAP-1** |
| 7 | Pending-segment auto-open on unlock | `main/index.js:315` `navigateToChannels(latestPendingSegment)` | Same as #3. | **GAP-16** |
| 8 | `load-guard` remote recovery | `main/load-guard.js` — ignores `file:` URLs | Goes inert; Phase 4 already says remove. WIRING.md documents it. | tracked |
| 9 | API base | `API_BASE = APP_ORIGIN` (`main/config.js:17`) | The API survives retirement; unaffected. | OK |
| 10 | Claude Code deep link | `claude://` (`main/attended-handoff.js`) — third-party, not ours | OK | OK |

---

## J10 — Public / marketing / legal

| # | Surface | Code | Post-retirement | Status |
|---|---|---|---|---|
| 1 | Landing `/` | `src/app/page.tsx` | Phase 4: becomes a download page. Hosts the only DMG link. | tracked |
| 2 | `/pricing` | `src/app/pricing/page.tsx`, public route (`src/proxy.ts:23`) | Plan says marketing dies — but the **API returns `${appUrl}/pricing` as `upgrade_url`** in two envelopes (`entitlements.ts:207,223`; `retention.ts:46`), and `site-nav.tsx:27` links it. | **GAP-11** |
| 3 | `/terms`, `/privacy` | `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, public routes (`src/proxy.ts:21-22`) | Linked from the login form's consent copy (`src/features/auth/components/login-form.tsx:180-181`) and from `/terms` → `/privacy`. **Legal pages must exist and be publicly reachable** — Stripe, Google OAuth verification and the App Store-style DMG distribution all assume live ToS/Privacy URLs. Not on the KEEP list. | **GAP-17** |
| 4 | OG / social metadata | `src/app/layout.tsx:50-90`, `metadataBase` = `NEXT_PUBLIC_APP_URL`, image `/img/site_thumbnail.png` | Lives in the root layout, which Phase 4's "delete remaining RSC pages, layouts" sweep would take with it. Must be preserved on whatever landing page survives. | **GAP-18** |
| 5 | `/admin/analytics`, `/admin/health` | `src/app/admin/*/page.tsx`, `isAdmin` gated, `notFound()` otherwise | **Never classified anywhere.** Not in web-pages.md, not in the plan's KEEP or delete list, not in `routes.tsx`. These are Samuel's only launch-funnel and system-health views. | **GAP-19** |

---

## J11 — Full page census: post-retirement fate of every `src/app/**/page.tsx`

| Page | Fate | Where decided |
|---|---|---|
| `[workspaceSlug]/(app)/page.tsx` (root redirect) | ported | `routes.tsx:74-77` (index → canvas) |
| `.../canvas`, `.../canvas2` | ported | `routes.tsx:48-49` |
| `.../ontology`, `.../ontology/[clusterSlug]` | ported | `routes.tsx:50-51` |
| `.../knowledge`, `.../knowledge/[kbSlug]` | ported | `routes.tsx:52-53` |
| `.../skills`, `.../skills/[skillSlug]` | ported | `routes.tsx:54-55` |
| `.../workflows`, `.../workflows/[workflowSlug]` | ported | `routes.tsx:56-57` |
| `.../chats` | ported | `routes.tsx:58` |
| `.../channels` | **route registered, no element** — placeholder | `routes.tsx:59` |
| `.../members` | ported | `routes.tsx:60` |
| `.../settings` | ported (partial — no account/billing/icon panes) | `routes.tsx:61` |
| `.../configuration` | ported | `routes.tsx:62` |
| `.../overview` | ported | `routes.tsx:47` |
| `/login` | **KEEP** | plan Phase 4 |
| `/oauth/authorize` | **KEEP** | plan Phase 4 |
| `/auth/desktop-start` | **KEEP** | plan Phase 4 |
| `/auth/desktop-handoff` | **KEEP** | plan Phase 4 |
| `/auth/desktop-complete` | **KEEP per plan, DELETE per auth-flows §3.2 item 6** — the two docs disagree | plan Phase 4 vs auth-flows.md |
| `/auth/reset-password` | **UNRESOLVED** | nowhere |
| `/onboarding` | port to SPA (slice not built) | plan Phase 4 |
| `/canvas` (top-level boot) | dies; replaced by SPA boot + `ensure-default` | web-pages.md §3 |
| `/invite/[token]` | **UNRESOLVED** | nowhere |
| `/join/[token]` | **UNRESOLVED** | nowhere |
| `/` (landing) | becomes download page | plan Phase 4 |
| `/pricing` | dies — but API still links it | **UNRESOLVED** |
| `/terms` | **UNRESOLVED** (legal) | nowhere |
| `/privacy` | **UNRESOLVED** (legal) | nowhere |
| `/admin/analytics` | **UNRESOLVED** | nowhere |
| `/admin/health` | **UNRESOLVED** | nowhere |

---

## Ranked GAP list

Severity is **user impact**: S1 = a user cannot use or pay for the product;
S2 = a core journey silently dead-ends; S3 = degraded or wrong-but-recoverable.

### S1 — blocks acquisition, access, or revenue

| # | Gap | Impact | Fix shape | Cite |
|---|---|---|---|---|
| **GAP-1** | **The SPA has no signed-out view and no sign-in control.** Sign-out, session expiry, and first launch all land on `PageError`/`PageLoading` or a refused remote navigation. Tray is the only entry. | Nobody can sign in from the app window; signing out bricks the UI until relaunch. | Add a `/signed-out` SPA route + a `window.dopl.beginSignIn()` bridge call; point `auth-actions.signOut`'s `load()` at it; drive it from `onAuthState('signed-out')` (`ui-bridge.js:163`). | `routes.tsx`, `app-shell.tsx`, `main/auth-actions.js:81`, `main/index.js:150` |
| **GAP-2** | **Desktop sign-in is Google-only.** `desktop-start` hardcodes `provider: "google"`; email+password, magic link and GitHub have no `dopl://` handoff. `use-login.ts:131` even comments "Only Google has the desktop handoff today." | Every non-Google user — and every new signup without a Google account — is locked out of a desktop-only product. | Generalise `/auth/desktop-start` to accept `?provider=`, and give the email/password + OTP paths a handoff (they already land on `/auth/callback`; add `desktop=1` threading). | `src/app/auth/desktop-start/page.tsx:20-22`, `use-login.ts:88-143` |
| **GAP-9** | **Checkout cannot run in the SPA and no billing UI is ported.** `loadStripe` needs a CDN script + iframes + XHR; CSP forbids all three. `return_url` is a remote page the window refuses and Phase 4 deletes. The settings page ships no billing pane. | No user can subscribe, upgrade or see their plan from the desktop app. Revenue path is dead. | Decide the model: (a) open Stripe **hosted** checkout via `openExternal` and switch `ui_mode` off `elements`, with a `dopl://billing/return` deep link; or (b) relax the SPA CSP for `js.stripe.com` (weakens the strongest security property in the build). Then port a billing pane. | `embedded-checkout.tsx:4,14,140-146`, `stripe.ts:108,112`, `vite.config.ts:26-36`, `apps/desktop-ui/src/pages/settings/index.tsx` |
| **GAP-10** | **Billing portal / cancel is unreachable.** `window.location.href = portalUrl` is a refused navigation; `return_url` `/canvas?billing=return` is deleted; the SPA hash router never sees `?billing=`. | Users cannot cancel or update payment — a consumer-protection problem, not just UX. | `window.dopl.openExternal(url)`; `return_url` → a KEEP-list bounce page that deep-links back; handle the billing-return signal over IPC, not the query string. | `plans-billing.tsx:96`, `stripe.ts:145`, `apps/desktop-ui/src/app.tsx` |

### S2 — a core journey silently dead-ends

| # | Gap | Impact | Fix shape | Cite |
|---|---|---|---|---|
| **GAP-16** | **Channel/agent notification clicks go nowhere.** `openChannel` loads `${APP_ORIGIN}/{segment}/channels` — refused by the SPA window — and `/channels` has no ported element. Fires from every task, trigger and FYI notification. | The agent-comms loop (the product's differentiator) loses its click-through entirely. | Re-point `navigateToChannels` at the SPA hash route over IPC; **channels must be ported before the window flip**, not "last". | `main/index.js:144-148,315,413-417`, `main/targeting-window.js:27-29`, `routes.tsx:59` |
| **GAP-4** | **`/invite/[token]` has no post-retirement home.** No invite email exists, no UI exposes the token, the landing page dies, and there is no `dopl://invite` verb. The in-app "pending invitation for my email" surface is also unported. | Email invitations become a feature that cannot be completed by anyone. | Either retire email invitations in favour of join links, or add a `dopl://invite/{token}` verb + an SPA accept screen + a KEEP-list web bounce page for people without the app. | `invitations.ts:58-61`, `src/app/invite/[token]/page.tsx`, `main/index.js:190-215` |
| **GAP-6** | **`/join/[token]` has no post-retirement home.** Same as GAP-4 for the shareable link — which, unlike invitations, *is* a first-class UI affordance. | Team growth loop breaks: the one link an admin can actually hand out stops working. | KEEP a minimal `/join/{token}` bounce page that offers "Open in Dopl" (`dopl://join/{token}`) + a download link for people without the app. Also add `/join/` to `PUBLIC_ROUTES` so the signed-out card is reachable. | `src/app/join/[token]/page.tsx`, `src/proxy.ts:4-38` |
| **GAP-5** | **The join link the app generates is `file:///join/<token>`.** `invite-dialog.tsx:71` reads `window.location.origin` in a `file:` renderer. Already broken on the ported members page. | Admins copy and send a dead link, with no error to tell them. | Introduce one app-origin config seam (see GAP-12) and use it here. | `src/features/members/components/invite-dialog.tsx:69-72` |
| **GAP-12** | **Every MCP-connect instruction in the app shows `file:///api/mcp`.** Five components read `window.location.origin`; two of them (`RemoteConnect`, and `McpConnectStep` once onboarding lands) are the primary agent-connect surface. | Users following the app's own instructions cannot connect an agent — the core setup journey. | Add `getAppOrigin()` backed by `import.meta.env` / the IPC bridge; replace all five `window.location.origin` reads. | `remote-connect.tsx:21-23`, `connect-clients.tsx:28-32`, `agent-skill-card.tsx:24-28`, `mcp-connect-step.tsx:27-31`, `welcome-popup.tsx:24-25` |
| **GAP-8** | **`/auth/reset-password` is not on the KEEP list.** The recovery email routes through `/auth/callback` (kept) to a page Phase 4 deletes. | Password reset dead-ends after the user has already clicked the email. | Add `/auth/reset-password` to the Phase-4 KEEP list (it is an auth-broker surface by the plan's own definition). | `use-login.ts:116-118`, `src/app/auth/reset-password/page.tsx`, plan Phase 4 |
| **GAP-13** | **Account deletion is unreachable in the desktop app.** It lives only in the settings modal, which the SPA deliberately does not mount. | GDPR/CCPA "delete my account" has no self-serve path once the web UI is gone. | Port an account pane (profile + delete) onto the SPA settings page; sign-out must go through main, not the browser Supabase client. | `delete-account.tsx:20,47-48`, `apps/desktop-ui/src/pages/settings/index.tsx` |
| **GAP-7** | **`JoinRequestNotices` is not mounted in the SPA shell.** | An approved joiner is never notified; the join journey has no terminal step. | Mount it (and decide the same for `ConnectAgentBanner`) in `AppShellLayout`. | `apps/desktop-ui/src/components/app-shell/app-shell.tsx`, `join-request-notices.tsx:31` |
| **GAP-17** | **`/terms` and `/privacy` are unclassified.** Referenced by the login consent copy, and required live by Stripe and Google OAuth verification. | Legal/compliance exposure and a possible OAuth-verification regression. | Add both to the Phase-4 KEEP list explicitly. | `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `login-form.tsx:180-181` |

### S3 — degraded, wrong, or operationally risky

| # | Gap | Impact | Cite |
|---|---|---|---|
| **GAP-11** | API 402 envelopes return `upgrade_url: ${appUrl}/pricing`, a page Phase 4 deletes — and the desktop client has no browser to open it in anyway. | `entitlements.ts:207,223`, `retention.ts:46` |
| **GAP-3** | `WelcomePopup`, `TourProvider` and `ConnectAgentBanner` are unmounted in the SPA — first-run guidance disappears entirely for new users. | `apps/desktop-ui/src/components/app-shell/app-shell.tsx` |
| **GAP-14** | Magic-link sign-in lands the *browser* on `/auth/callback` with no `dopl://` bounce (only `?desktop=1` gets one), so the session never reaches the app. Compounds GAP-2. | `use-login.ts:100-108`, `src/app/auth/callback/route.ts:21,31` |
| **GAP-19** | `/admin/analytics` and `/admin/health` are classified nowhere. They are the only launch-funnel and system-health views and would be swept by "delete remaining RSC pages". | `src/app/admin/*/page.tsx` |
| **GAP-18** | OG/social metadata lives in `src/app/layout.tsx:50-90`; the Phase-4 layout sweep would drop link previews for the download page. | `src/app/layout.tsx:50-90` |
| **GAP-15** | The Supabase project's **Site URL** (dashboard config, outside this repo) backs provider-confirm emails. Nothing in the plan mentions re-pointing it. | Supabase dashboard |
| **GAP-20** | The packaged CSP is `img-src 'self' data: blob:`, but the ported rail and member lists render **remote** https images (`app-rail-core.tsx:43` workspace icons, `shared/ui/avatar.tsx:48`, `avatar-stack.tsx:38`). Every avatar and workspace icon is blocked today. | `vite.config.ts:26-36`, `app-rail-core.tsx:43` |
| **GAP-21** | Workspace icon **upload** has no SPA path — the IPC bridge carries JSON only (noted in the SPA shell's own docblock), so `workspace-icon-uploader.tsx` is unportable as written. | `apps/desktop-ui/src/components/app-shell/app-shell.tsx` docblock, `workspace-icon-uploader.tsx:33,55` |
| **GAP-22** | `main/index.js:215` still loads `${APP_ORIGIN}/auth/desktop-complete`. auth-flows §3.2 says delete it; the plan's KEEP list says keep it; WIRING.md's integration steps mention neither. Two docs disagree and the code follows the wrong one. | `main/index.js:215-218`, plan Phase 4, auth-flows.md §3.2 item 6 |
| **GAP-23** | `DOWNLOAD_URL` is `Dopl-arm64.dmg` only. A desktop-only product with an arm64-only artifact excludes Intel Macs and all Windows/Linux users. | `src/features/marketing/constants.ts:24` |

---

## What this invalidates in work already done

1. **"Port channels last" is now wrong.** GAP-16 makes `/channels` a
   *prerequisite* of flipping the window, not the final slice — every OS
   notification's click handler targets it.
2. **The Phase-4 KEEP list is incomplete.** It must also name
   `/auth/reset-password`, `/terms`, `/privacy`, a `/join/{token}` bounce, and a
   decision on `/pricing` and `/admin/*`.
3. **web-pages.md's page census is not a census.** It covers only
   `[workspaceSlug]/(app)/**`. Eleven top-level pages were never classified;
   nine of them are still unresolved.
4. **Three ported pages ship live bugs today** that the per-slice code reviews
   did not catch because they are journey-level: settings (`file:///api/mcp`),
   members (`file:///join/<token>`), and canvas/chats/members (Stripe modal that
   cannot render under the CSP).
5. **The plan's Phase-2 exit criterion** — "bundled app covers all daily
   workflows with no remote page loads" — is not satisfiable as written while
   sign-in, sign-out, billing and notification-click all still require remote
   pages.
