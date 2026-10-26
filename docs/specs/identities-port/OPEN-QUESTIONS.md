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

6. **Join on the identity's NAME.** Sessions carry `identityName` (a spawn-time snapshot), not an id,
   so a renamed identity loses its history and two rows of one name share it. Each session is listed
   once, under the first match. An `identityId` on the session summary would make it exact.
7. **Grid 4 → 3 across**, as staging did for the rail. `IDENTITY_GRID` also sets the workspace
   Agents page, which has no rail (allowed by the bleed ruling).
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
