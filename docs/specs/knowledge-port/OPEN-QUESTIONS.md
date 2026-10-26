# Knowledge port: open questions (branch `ui/port-knowledge`, 2026-10-26)

## Knowledge port

1. **The /home Knowledge face stays in `apps/desktop-ui`.** The ontology port moved its face into
   `src/` so the playground mounts it; doing the same here would delete or rewrite
   `knowledge-panels.tsx` / `knowledge-panel-cards.tsx`, which `ui/port-ontology` edits by one line
   each (the `EmptyLine` move). Chose: leave the desktop host files alone and keep playground
   copies of them (`knowledge-staging/home/*`, `desktop/*`), the channel port's host precedent.
   Every component under the host is the product's. Revisit after the ontology merge: moving the
   face into `src/` would let the playground drop the copies.
2. **The playground answers the API in memory through a `fetch` shim** (`knowledge-staging/
   fetch-shim.ts`), not by dependency injection: the face reaches 28 routes (`server/routes.ts › ROUTES`, 2026-10-26) through three
   features' clients. Not covered: the realtime subscription and the signed-in profile read under
   presence still run against the configured Supabase project, signed out (no data either way).
   The staged doc pane therefore shows no peer reading (the old stub showed Grace).
3. **Changelog `framed` prop.** The object panel on `ui/port-ontology` is a white card, so its
   History passes `framed={false}` (`ontology/components/object-history.tsx`, one added line). The
   ontology changelog keeps the card.
4. **`.uis-white-pane`.** `ui/port-ontology` rewrites that block in `ui-staging/staging.css` to an
   ontology-only `.uis-onto-pane`. The knowledge playground now wears its own `.uis-kb-pane`
   (added above that block so the two edits do not touch); the old block's comment still names
   knowledge until the ontology branch lands.
5. **Tree hover vs selected.** The 2026-09-29 ruling made hover and selected one gray
   (`--home-panel`); the staging design (ported) separates them by a step (raised-1 / raised-2 +
   medium label). Followed the staging look; the `layout-rules.test.ts` pin now says so.
6. **Channel-grant level copy.** "None" became "Not shared" and team "None" became "No access"
   (staging copy), with one-line descriptions in the menus.
