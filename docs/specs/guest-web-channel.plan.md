# Guest web channel — M0 research plan (2026-08-25)

Deliverable of M0 (spec: `guest-web-channel.md`). Three disjoint research passes (claim
flow/handoff, web auth/API fences, surface web-mount) synthesized here. File paths are
the plan's spine; rulings the spec does not answer are listed at the end and were posted
`BLOCKED:` to the channel — M1 does not start until they are answered.

## Headline: the mount is nearly free

`channel-surface-standalone.tsx` is native to the Next tree (the SPA borrows it via the
`@` alias). In a plain browser every seam resolves itself:

- **Transport**: `src/shared/api/api-client.ts › apiRequest` — `getSpaBridge()` returns
  `null` in a browser, the fetch branch runs: same-origin `/api/channels/**`,
  `x-workspace-id` header, `credentials: "same-origin"`. Zero configuration.
- **Realtime**: `src/shared/realtime/shared-channel-registry.ts` falls through to the
  websocket branch automatically; needs only `NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY`
  (present — the Next app is the canonical consumer) and the guest's cookie session
  (RLS fences the subscription). Doorbell wiring lives inside `useChannelSurfaceData`,
  which the standalone host mounts — never render `ChannelSurface` directly.
- **Query client**: `QueryProvider` at `src/app/layout.tsx` root. Nothing to add.
- **Tokens/kit**: `src/app/globals.css` at root layout carries the full set.
- **SSR**: whole tree is `"use client"`, no module-scope globals; still mount via
  `next/dynamic` `ssr:false` (nothing lost, honest expression of client-only).
- **Agent-launch controls**: already invisible to guests by bridge feature-detection
  (`canLaunchAgents()` etc. — all `null` in a browser). Spec's "no agent-launch
  controls for guests" is largely free.

## M1 — web mount

1. **Route: `src/app/c/[workspaceId]/page.tsx`** (raw container UUID, not segment).
   Justification (spec allowed research to pick): the claim response
   (`HomeLinkClaimResult.channel.workspaceId`) carries the UUID; `X-Workspace-Id` is
   UUID-only (`resolveActiveWorkspace` 400s on a segment); `findMemberContainer` takes
   the UUID; UUIDs are lowercase so the proxy's 308 canonicalization is harmless. The
   URL is a destination after a redirect, not a shared canonical link.
2. **Fence (the billing-page skeleton, `src/app/billing/[segment]/page.tsx`)**:
   `export const dynamic = "force-dynamic"`; `getUser()` → `redirect('/login?redirectTo=…')`;
   then a NEW service read `getHomeChannel(userId, workspaceId)` in
   `src/features/home/server/service-reads.ts` composing `findMemberContainer` (absent →
   `notFound()` — refuses non-members AND standard workspaces, no existence oracle) +
   `hydrateOneChannel`. The repo function is not called from the page (§2 layer split).
3. **Mount**: client component mirroring
   `apps/desktop-ui/src/pages/home/relationship-record.tsx` — resolve the `Channel` row
   via `useChannels(workspaceId, false)`, render `<StandaloneChannelSurface>` with
   `capabilities={{ memberManagement: false }}`, **omit `role`** (least-privilege
   default), `onDeleted` → a "this channel is gone" terminal state. Bounded-height flex
   parent (`h-[100dvh] flex`) — nothing in the Next tree supplies this today.
4. **Route bookkeeping (all three lists, same class as `link`)**:
   - `src/config/index.ts › RESERVED_WORKSPACE_SLUGS` += `"c"`.
   - `src/shared/lib/url/website-retirement.ts › RESERVED_TOP_LEVEL` += `"c"` (KEEP is
     currently accidental; the file's own norm says name it).
   - `src/shared/layout/layout-shell.tsx`: deliberately NOT in `NON_WORKSPACE_ROOTS`
     (the listed branch renders a centred container — wrong for full-viewport); add the
     one-line comment naming `/c/` and handle background per ruling R5.
   - NOT in `PUBLIC_ROUTES` — by omission the middleware gives the signed-out 307 to
     `/login?redirectTo=/c/<id>`, which the login form and `/auth/callback` honour.
   - Tests: `src/proxy-matcher.test.ts` "must reach the gate" row; `src/proxy.test.ts`
     signed-out redirect row; retirement KEEP row (backfill `/link/tok_x` alongside).
5. Gates, commit.

## M2 — live + writes

Posting (`POST …/messages`), doorbell refetch, presence all ride the existing surface —
expected near-zero code. Work items:
- Verify realtime end-to-end in a real browser session at http://localhost:3001
  (registry degradation is a console-warn-only failure; check the doorbell actually
  rings). Watch realtime token refresh over a long session (flagged risk).
- Composer parity per rulings R1–R3 (Agents tab, Leave row, ChannelAgentSettings):
  implement whichever `ChannelSurfaceCapabilities` extensions Samuel rules for.
- Fix the stale claim-card test stub (`relationship:` → `channel:`) latent since
  2026-08-24.

## M3 — claim handoff

- `src/app/link/[token]/claim-card.tsx`: widen `ClaimOutcome` to read
  `channel.workspaceId`; `HandoffPanel` attempts `dopl://open/home` (anchor stays the
  contract) and shows a visible "Continue in your browser → /c/<id>" fallback — never a
  trap. Claim endpoint changes: none (response already carries everything).
- **Documented reversal of a deliberate fence**: `claim-card.test.tsx` "binds no router
  at all" + the card docblock ("nothing here navigates the web app") were written
  against exactly this feature. The spec is the owner ruling reversing them. Rewrite
  docblock to name the reversal; replace the assertion with a semantically equivalent
  pin (dead/gone paths still never navigate; only a successful claim does).
- Dead states: web parity with the collapsed ending (`expired||revoked||exhausted` →
  one panel, no navigation; mid-claim 410 `gone` collapses identically). Preserve the
  absence assertions (`expect(navigated).toBeNull()`) on both dead paths.
- Fix stale doc comment `src/features/home/types.ts` (`/c/<token>` → `/link/{token}`).

## M4 — hardening

- Leak review write-up, per guest-reachable endpoint (research already enumerated):
  members email door (F-299, three doors: `mapMemberRow.email`, `HomePeer.email`,
  `mapMessageRow.authorName` fallback), sessions coarse projection (safe by two-mapper
  construction), consent/mentions/directives own-scoped, `/api/home/channels` NOT
  container-scoped (page must bootstrap container-scoped, never off the home list),
  `/api/workspaces` unfiltered by contract (page must not call it), IndexedDB persister
  holds transcript until sign-out (ruling R6).
- PUBLIC_ROUTES re-check + **add the missing pin**: no test today asserts the
  `/api/home/link/` (public) vs `/api/home/links` (gated) split INVARIANTS claims is
  pinned — add it with the `/c/` rows.
- Full gate table (INVARIANTS §14). Docs: INVARIANTS (new route, layout-shell note,
  fence reversal), REFACTOR-FINDINGS (below), ENGINEERING only if earned. KB sync.

## Findings to file (next free F-id, verify at write time)

1. Stale test stub `claim-card.test.tsx` (`relationship: {}` — key renamed 2026-08-24).
2. Stale doc comment `types.ts` claim URL (`/c/<token>` vs actual `/link/{token}`).
3. Retirement KEEP test omits `/link/tok_x` though `link` is reserved.
4. `deep-link-target.js › WEB_ONLY_ROOTS` lists `join`/`invite` but not `link`.
5. INVARIANTS §3 "proxy.test.ts pins the set" for the singular/plural split — no such
   test exists (doc/code disagreement; the pin gets ADDED in M4, doc then true).
6. INVARIANTS §3 F-209 bullet stale: `/authenticate`, three `AUTH_ENTRY_ROUTES`, and
   `LOOP_COUNTED_AUTH_ROUTES` all exist in the tree today.
7. DESIGN-SYSTEM.md overstates skeleton a11y (measured 2026-08-25): it claims every
   skeleton carries `role="status"` + `aria-busy` + `sr-only`; only the two page-level
   composites in `src/shared/ui/skeleton.tsx` do. `DetailPaneSkeleton`,
   `DetailDocSkeleton`, `TranscriptSkeleton` carry none, so `relationship-record.tsx`'s
   loading state is announced as silence. Doc is the wrong side (fix doc; desktop
   loading-state gap is a finding).
8. Root typecheck is RED with a running dev server (measured 2026-08-25): tsconfig
   includes `.next/dev/types/**/*.ts`; Next lazily generates `ParamCheck<RouteContext>`
   files per route hit in dev, and the `withUserAuth`/`withWorkspaceAuth` returned
   handlers declare `routeContext?: {...}` (optional second param), which is not
   assignable to `RouteContext`. Every wrapped route that dev traffic has compiled
   fails. CI never sees it (clean checkout, no `.next/`), so the gate is
   environment-dependent — red exactly when the mandated always-on dev stack has
   served API traffic. Pre-existing; not from this feature. Ruling R8 below.

## Rulings requested (posted BLOCKED to the channel; M1 waits)

- **R1** Guest sees the Agents tab (desktop-app explainer + operator's peer-session
  cards, "Samuel's agent is working…")? Recommend: accept — transparency about the
  agent they're talking to; else new `capabilities.agents:false` (tab row is not a slot).
- **R2** Guest sees "Leave channel" (irreversible: link already revoked)? Recommend:
  hide via new capability flag.
- **R3** Guest sees `ChannelAgentSettings` (tool profile — guest runs no agent; not
  bridge-gated)? Recommend: hide via the same capability work.
- **R4** Claimer is workspace `admin` (§4A design), so the SERVER permits
  rename/archive, thread delete/close, minting a further link — UI narrowing (omit
  `role`) hides but does not deny. Accept for MVP (2-person trust, operator can delete)
  or change the claim role (§4A blast radius)? Recommend: accept for MVP + document.
- **R5** Page chrome: recommend NOT listing `/c` in `NON_WORKSPACE_ROOTS` (bare,
  full-viewport) and overriding the `#2c3640` body paint with the page's own token
  background, comment in `layout-shell.tsx` naming it deliberate.
- **R6** Operator transcript persists in guest's IndexedDB (query persister; wiped on
  sign-out). Recommend: accept for MVP, name it in the leak review.
- **R7** F-299 (peer email visible, no accept step) — already open and "re-ask Samuel"
  flagged; the web surface makes it more reachable (no install needed). Confirm
  accepted for MVP, or scrub `email` from guest-reachable DTOs (blast radius: desktop
  shows email today).
- **R8** Root typecheck red locally (finding #8 above): fix the wrapper signature
  (make the returned handler's second param `RouteContext`-compatible — touches the
  auth wrapper every route composes) in this feature's M4, or file the finding and
  leave it? Recommend: fix in M4 with its own mutation-verified test, since M1 adds
  a page to the same tree and every local gate run until then reports red.

Notes, not blockers: billing on link containers is §4A-provisional ("re-ask before the
next billing change touches this path") — this feature makes no billing change; guests
run no agent and burn nothing. `/auth/callback` provisions a standard workspace for any
brand-new guest (`ensureDefaultWorkspace`) — existing behavior, unchanged here.
