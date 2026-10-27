# Overview port: open questions (2026-10-26, branch `ui/port-overview`)

Each: the question, what was chosen, where.

1. **Cards with no data behind them.** Agents by computer, Activity (Routing / Logs), the reach
   order, device In use / battery / "through" host, and the Needs-you asks are mock in staging.
   Chose: not shipped; Needs you carried the one real state (a spent allowance) until item 13.
   Superseded by item 14: they draw from an account's preview data. Where:
   `src/features/home/components/overview/home-overview.tsx`, INVENTORY §4.
2. **Where Devices sits.** Staging puts Devices last in the side column, beside Agents and Activity.
   With those two hidden the main column would hold Needs you alone at 900px. Chose: Needs you +
   Devices in the main column, Credits + Tokens in the side; the columns are Credits + gap + Tokens
   tall (462px) and still end on one line. Where: `overview.module.css › .root` (`--ove-cols-h`).
3. **Devices poll on a cold face.** The devices hook refreshes presence every 30s; every other
   Overview read is cold. Chose (review): `useConnectedDevices({ live: false })` from the Overview,
   so the face stays cold and presence is as of the read; Settings › Devices keeps the refresh.
4. **Add device.** Staging's inline kind picker + pairing code had no product flow beyond glasses.
   Chose: the button opens Settings › Devices, where pairing lives. Where: `home-overview.tsx`.
5. **Token honesty line.** The old panel carried a sentence ("At least this many: reported spend is
   rounded down…"). Staging keeps only "At least N". Chose: staging copy; the floor stays in the
   figure and in `formatTokens`; the truncated note stays. The workspace strip keeps its sentence.
   Where: `overview-tokens.tsx`.
6. **Token spend no longer folds away.** The old panel vanished with no runs; the staging card is a
   fixed slot. Chose: always a card, "No agent has spent tokens" when empty, "Couldn't load token
   spend." on error.
7. **Scope menu order.** Product: All channels, channels, Desktop agent. Staging: All channels,
   Desktop agent, channels. Chose: staging. Where: `overview-credits.tsx › ScopeMenu`.
8. **Error state.** Staging shows the message and Try again in its pills; the product also offered
   Reload. Chose: the shared `shared/ui/page-error.tsx › PageError` (Try again + Reload, its own
   `btn-light` face), one implementation over the staging pills. Where: `home-overview.tsx`.
9. **The allowance waited for the series.** The old bar ghosted until the ledger series landed too.
   Chose: the allowance and the daily bars ghost independently (they are separate blocks in the
   staging card).
10. **Skeleton.** Staging ghosted white cards with a local pulse. Chose: the INVARIANTS §1A rule
    (flat containers, `Skeleton` atoms), on the face's own geometry. Where: `overview-skeleton.tsx`.
11. **Copy the old rulings removed.** Staging titles the card "Credits" and says "of N used", words
    the 2026-09-13 ruling had dropped; "Get more credits" is a card pill, not the 36px page button.
    Chose: staging (the newer design). INVARIANTS updated.
12. **Channels rows open their channel (branch `ui/overview-channel-rows`).** Chose: a row with no
    cached channel stays plain text; hover/focus is the flat menu-row fill (no lift on a table row,
    cells gain 8px side padding for it); faces cap at 3 + N; the playground goes to
    `/playground/channels`. Where: `overview-ledger.tsx › ChannelsTable`.

13. **Needs you sources (branch `feat/overview-needs-you`).** Samuel approved tasks + decisions as
    sources (2026-10-26). Chose: (a) a sibling read `GET /api/home/needs` rather than a field on
    `/api/home/overview`, so a failure is the card's alone; (b) the fence is the reader's HOME
    channels only (link containers), matching the rest of the face — standard-workspace channels
    are not listed; (c) a decision's author shows as "Agent" or the person's name (agent names
    resolve from the desktop feed at render elsewhere; the Overview has no such feed); (d) the
    staging task and decision rows both go to `/playground/channels`; (e) the type lives in
    `src/features/home/needs-types.ts`, not `@dopl/contracts` (one tree consumes it). Where:
    `overview-needs.tsx`, `server/service-needs.ts`.

14. **Preview data (branch `feat/preview-data`).** Samuel: "just hardcode in data to my account
    specifically so that it will all show". Chose: a service-role table `account_preview_data`
    keyed `(user_id, surface)` and `GET /api/home/preview`, so no user id sits in code; item 1's
    cards draw only from it. Sub-choices: (a) approval / question rows carry no Approve / Deny /
    Answer buttons (they would act on nothing); (b) the time columns print wall-clock only
    (`formatClockTime`), so a seed does not read as days old; (c) a preview device that matches no
    real row by id or name is listed as its own row when it names a `kind` (the phone has no source);
    (d) the Add device kind picker shows the seeded code and its Pair opens Settings › Devices, so
    pairing still works; (e) either Agents or Activity switches the grid to staging's three-card
    columns, with Devices moving under Tokens; (f) the playground's demo computers are renamed to
    the seed's ("Samuel's MacBook Pro", "Samuel's Mac Studio") so the merge shows there too. Where:
    `overview-agents.tsx`, `overview-devices.tsx`, `overview-needs.tsx`, `home-overview.tsx`,
    `overview-staging/overview-preview-seed.json`.

## For Samuel (review, 2026-10-26): reversals of earlier rulings the staging look brings

Not changed; listed so each can be confirmed or sent back.

- **Per-day readability vs `BarSeries`** (his 2026-09-08 reference chart: a labelled Y axis, a
  slanted date caption on every bin, ink axes). The staging bars have none. Shipped: each bar
  carries a hover title and an accessible name ("Sep 3 · 120 credits", "Oct 25 · 1.2M tokens");
  the axis and captions are his call.
- **The stat tiles return** as the summary strip (Need you, Devices online, Credits left); the row
  of stat tiles was cut on 2026-09-01.
- **Token spend no longer folds away** when nothing was spent: the Tokens card is a fixed slot that
  says "No agent has spent tokens".
- **Month and scope controls 14px → 13px**: the 2026-09-13 ruling put them on the 14px
  `IDENTITY_NAME_TEXT` face; the staging card sets them at caption size.
- **"Messages by channel" ranking is gone**: messages are a column of the Channels table, which is
  ordered by credits.
- **People shows a role tag for every role** (owner, member, guest); the old rail marked guests
  only (the guest subtotal is kept).
- **Card titles 12.5px semibold → 14px medium**: Samuel asked for the Identities section-title face, so
  `OverviewCard` wears `IDENTITY_NAME_TEXT`; `SECTION_TITLE` stays for the ontology object panel.
