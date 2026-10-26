# Overview port: open questions (2026-10-26, branch `ui/port-overview`)

Each: the question, what was chosen, where.

1. **Cards with no data behind them.** Agents by computer, Activity (Routing / Logs), the reach
   order, device In use / battery / "through" host, and the Needs-you asks are mock in staging.
   Chose: not shipped; Needs you carries the one real state (a spent allowance). Where:
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
