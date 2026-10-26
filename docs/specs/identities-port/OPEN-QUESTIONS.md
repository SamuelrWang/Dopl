# Identities port: open questions (2026-10-26)

Each one: the question, the conservative choice made, and where it lives.

## Staging surfaces with no product data (not invented)

1. **"All channels" scope and per-row reach.** Staging showed every channel's shared identities with
   a scope control and "Shared in #a and #b". The product reads one container per selected channel,
   and whether a shared identity can reach several channels is a product question (staging PORTING
   said so). **Chose:** the shared section stays the selected channel's; no scope control; the head
   reads "N shared in this channel · M personal"; the scope line is the section's own label.
   `identities-home.tsx`, `identity-page-controls.tsx › IdentityPageHead`.
2. **Tools and rules tab.** Tools, rules and escalations are not fields on an identity. **Chose:**
   the tab is not shipped; the view has Identity, Activity, Running. `identity-view-dialog.tsx`.
3. **Activity log per identity.** Staging's log rows ("Cut 1.7.24 and posted notes", permission
   chips) have no source. **Chose:** Recent / Activity list this machine's ENDED agents (the desktop
   keeps them seven days), titled by thread, timed by `endedAt`; no permission chip.
   `lib/identity-runs.ts › endedRuns`.
4. **Runtime re-auth state and the fix button.** The desktop reports only connected or not.
   **Chose:** "X is not signed in", no button (a button with no action would be dead).
   `identity-page-controls.tsx › RuntimeReadinessLine`.
5. **"Not used yet".** With no session on record the product cannot say never (the feed keeps seven
   days). **Chose:** no last-used text instead of "Not used yet". `identity-section.tsx`.

## Choices worth a look

6. **Join by id (resolved in review).** Main now stamps the identity id at spawn and publishes
   `identityId` on the session summary (local only); the page joins on it. Sessions from a desktop
   older than this fall back to the name (whitespace-collapsed; a shared row must be in the
   session's workspace), so until the desktop ships a renamed identity's older agents are unmatched.
7. **FOR SAMUEL: grid width.** Your 2026-09-13 ruling is four per row; the staging look beside the
   Activity rail is three. Chose: three on /home only (`IDENTITY_GRID_RAIL`, passed by the host),
   four on the workspace Agents page, which has no rail. Say if /home should be four too.
13. **"Recently used" as the default sort.** Kept. The order reads a usage snapshot that refreshes
   only when the rows, the search/filter/sort or the feed's availability change, so cards do not
   jump on each session push; they do re-sort the next time one of those changes.
8. **Status pill face.** Staging drew a white hairline pill (the page's grey ban); the product's one
   `StatusPill` is the kit's grey `.status-pill`, kept so the app has one pill. Retint the kit if the
   grey ban should hold everywhere.
9. **Run card hover** is `.select-card` (firmer hairline) rather than staging's deeper shadow, to
   reuse a kit recipe.
10. **Worn by** on a shared card is every channel peer (staging was a per-row mock).
11. **Playground editor runtimes.** The product editor reads the desktop bridge for runtimes and
    catalogs, so on `/playground/identities` its Runtime / Model rows offer only Any / Default. Cards
    still show runtimes (the stub host passes catalogs).
12. **Concurrent shared files.** Additive only: `SectionPanel flat`, `.title-chip`, `.rail-layout`,
    `ModalShell size="panel"`, `HomePane`'s `viewer` prop, the identities `.pane` rule in
    `home.module.css`. A knowledge/overview worker adding a similar flat face should reuse `flat`.

## Samuel's Electron review (2026-10-26)

14. **One create button, which scope.** The single "+ Agent Identity" (controls row, right end)
    creates a PERSONAL identity. A shared one is created from the Shared grid's dashed "Create new"
    cell. Asked: filler only when Shared is empty; chose: also as the grid's last cell when it has
    rows (hidden while a filter hides every row), otherwise a non-empty channel would have no way
    to share a new identity. Member+ only; a guest sees the plain empty line.
15. **Section titles** wear `SECTION_TITLE` (the Overview "Needs you" face) with no grey chip;
    the kit's `.title-chip` is deleted.
16. **Readiness line removed** with its code (`runtimeReadiness`, the page head). Not-signed-in
    runtimes now surface only at launch, as before the port.
17. **Search** is `SEARCH_PILL_FACE`, the header search's own face, now one constant both read.
    The kit's `.search-expand` recipe has no wearer left but is still pinned by
    `home-search.test.ts`; left for a sweep.
18. **Activity tabs** use `SegmentedControl variant="underline"` (no raised face), matching the
    view popup and the /home header. Faces: run cards 28 → 34px, recent rows 22 → 30px.
19. **Rail width** defaults to 300px, 240–480px and at most half the pane, per device
    (`dopl.identities.railWidth`).
20. **Launch** is `INK_PILL` (the card's primary act), bottom right.
21. **Section titles, again** (supersedes 15). Shared / Personal (and Activity, the third `SectionPanel flat`) now
    wear `IDENTITY_NAME_TEXT`, the ontology switcher's face (14px medium ink); chose to reuse that
    existing constant in both places instead of minting an identical `PAGE_NAME_TEXT`.
