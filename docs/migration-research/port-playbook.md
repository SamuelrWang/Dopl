# Page-Port Playbook (Phase 2)

The per-slice process for porting app pages into `apps/desktop-ui`. Every
port agent gets this file + `web-pages.md` (its page's section) + the
scaffold's `apps/desktop-ui/CONVENTIONS.md`. Deviate from none of them.

## The slice loop

1. **Read**: your page's section in `web-pages.md`; the live page under
   `src/app/[workspaceSlug]/(app)/<page>/`; the feature's client components
   under `src/features/<feature>/`.
2. **Build**: replace the placeholder route component in `apps/desktop-ui`
   with the real page. Rules:
   - The RSC's server fetches become client queries via the scaffold's data
     layer (same query keys as the web app's client components where they
     already exist — cache coherence matters).
   - REUSE the feature's existing client components (`src/features/*/
     components`, `hooks`, `client/*`) by import wherever they are
     Next-free (`web-pages.md` flags which are). In the SPA, `@/…` resolves
     to the repo-root web tree (same meaning as inside it) and `#/…` is
     SPA-local — so a web module and its transitive imports work verbatim.
     Do NOT fork a component to strip a `next/*` import — extract the
     Next-free core into the feature dir and have both apps import it (the
     web app keeps working). The vite build fails loudly if a next-coupled
     module sneaks into the graph; the eslint fence refuses `@/app/*` and
     server layers.
   - `next/link`/`useRouter` → the SPA router's equivalents at the page
     seam only.
   - Realtime hooks (`features/*/client/realtime.ts`) work as-is (they ride
     the shared registry) — wire them exactly as the web page does.
   - No new patterns. If the scaffold lacks something you need, STOP and
     report the gap instead of inventing a second way.
3. **Verify** (all of it, yourself):
   - `npx tsc --noEmit` in apps/desktop-ui — clean.
   - The SPA vitest suite + a new smoke test for your page (renders with
     mocked data layer, key interactions fire the right API calls).
   - Root `npx tsc --noEmit 2>/dev/null | grep "error TS" | grep -v "^\.next/"`
     — still empty (you touched shared feature files; the WEB APP must
     still compile).
   - Root `npx vitest run` on any feature test files adjacent to what you
     touched.
   - `npx eslint` on everything you touched.
4. **Report**: files touched, verification output, extractions performed
   (component moved from X to Y), gaps hit.

## Port order & parallelism

Waves of ≤3 concurrent agents; pages in a wave must not share feature dirs:

- Wave 1: overview · skills · chats
- Wave 2: knowledge · workflows · members
- Wave 3: ontology+canvas (one agent — shared graph engine) · settings ·
  configuration
- Wave 4: channels (ALONE, after everything else is stable — consent
  machine, presence, 4 realtime subscriptions, Electron-bridge call sites;
  see the channels guardrails in DESKTOP-MIGRATION-PLAN.md)

## Acceptance gates per wave

- Reviewer agent passes over each slice (real defects only).
- The web app still builds (`npx next build`) — shared-file extractions
  are the risk.
- After wave 4: full channels smoke test before any release
  (send/receive, consent request+decide, roster pills, two windows).

## What ports do NOT do

- No auth work (the scaffold + main process own tokens).
- No new API routes (report gaps instead; the gap-builder owns them).
- No styling reinvention — token classes only, same as the web page.
- No `dynamic`/SSR concepts — there is no server render in the SPA.
