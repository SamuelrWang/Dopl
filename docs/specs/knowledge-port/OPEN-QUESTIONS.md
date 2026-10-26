# Knowledge port: open questions (branch `ui/port-knowledge`, 2026-10-26)

## Knowledge port

1. **The /home Knowledge face stays in `apps/desktop-ui`.** The ontology port moved its face into
   `src/` so the playground mounts it; doing the same here would have rewritten
   `knowledge-panels.tsx` / `knowledge-panel-cards.tsx` while `ui/port-ontology` was editing them
   (the coordinator asked for minimal edits there). Chose: leave the desktop host files alone and
   keep playground copies of them (`knowledge-staging/home/*`, `desktop/*`), the channel port's
   host precedent. Every component under the host is the product's. Now that the ontology port is
   on master, moving the face into `src/` (with its skeletons as host slots) would let the
   playground drop the copies; not done here.
2. **The playground answers the API in memory through a `fetch` shim** (`knowledge-staging/
   fetch-shim.ts`), not by dependency injection: the face reaches 28 routes (`server/routes.ts › ROUTES`, 2026-10-26) through three
   features' clients. Not covered: the realtime subscription and the signed-in profile read under
   presence still run against the configured Supabase project, signed out (no data either way).
   The staged doc pane therefore shows no peer reading (the old stub showed Grace).
3. **Changelog `framed` prop.** The object panel on `ui/port-ontology` is a white card, so its
   History passes `framed={false}` (`ontology/components/object-history.tsx`, one added line). The
   ontology changelog keeps the card.
4. **Tree hover vs selected.** The 2026-09-29 ruling made hover and selected one gray
   (`--home-panel`); the staging design (ported) separates them by a step (raised-1 / raised-2 +
   medium label). Followed the staging look; the `layout-rules.test.ts` pin now says so.
5. **Channel-grant level copy.** "None" became "Not shared" and team "None" became "No access"
   (staging copy), with one-line descriptions in the menus.
