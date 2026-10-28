RESOLVED 2026-10-27 (Samuel): the current desktop app is the approved design; every open look/copy question here is settled as currently built unless reopened. Bars gain bottom date labels (no y-axis).

# Knowledge port: open questions (branch `ui/port-knowledge`, 2026-10-26)

## Knowledge port

1. **The playground answers the API through the SPA bridge** (`knowledge-staging/staging-bridge.ts`),
   the ontology playground's seam, not a `fetch` shim: realtime is off and presence stays local as
   in the desktop renderer, and nothing touches `window` during server render. Cost: the export
   download is a plain `fetch` (`knowledge/client/api.ts › downloadKnowledgeExport`), so on the
   playground it gets the real route's refusal. Chose to leave it rather than route `fetch` too.
2. **Changelog `framed` prop.** The ontology object panel is a white card, so its History passes
   `framed={false}` (`ontology/components/object-history.tsx`). The ontology changelog and the
   knowledge base keep the card.
3. **Tree hover vs selected: staging look, approved 2026-10-26, supersedes 2026-09-29.** The
   2026-09-29 ruling made hover and selected one gray (`--home-panel`); Samuel approved the staging
   Knowledge page with the split (raised-1 hover, raised-2 + medium selected). The
   `layout-rules.test.ts` pin says so.
4. **Level copy.** Channel grants read "Not shared / Agent only / Visible"; team access is one
   control for knowledge sharing and team creation (`members/components/team-bits.tsx ›
   AccessLevelControl`, "No access / Read / Edit", generic descriptions "Can open it" / "Can open
   and change it"). The create-team dialog's segmented control became that menu.
5. **The ontology board's description** (`ontology-view.tsx`) moved onto the shared
   `InPlaceDescription` with the object panel and the knowledge heads; its face is unchanged
   (single line, quiet underline, secondary ink).
