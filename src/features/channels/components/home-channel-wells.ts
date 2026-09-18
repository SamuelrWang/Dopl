/**
 * /home's CHANNEL LIST WELL SET — **Pinned / Recent / Earlier**, as DATA.
 *
 * 🔒 **SAMUEL, 2026-09-15, verbatim:** *"look on the agents tab, there is the gray
 * box, for recents, 7 days, etc. I want to bring that over. Basically, one for
 * Pinned, one for Recents (this will be in effect channels with activity in the
 * last 24 hours), and Earlier."* **Three wells, not four** — he named the set, and
 * the 7-day / 30-day spans he did not name are the Agents tab's.
 *
 * ⚠ **THE SET ONLY. WHICH WELL A ROW LANDS IN IS
 * `apps/desktop-ui/src/pages/home/channel-wells.ts › channelWellOf`**, because
 * that answer reads a `HomeRow` — a SPA type over a cached payload, with the
 * `myFavoritedAt` fallback INVARIANTS §8 requires. The seam is the one
 * `collapse-wells.tsx` already draws between a caller's set and the box: this
 * file is the set, that one is the box, and the filing rule stays with the data.
 *
 * ⚠ **IT LIVES IN THE ROOT TREE SINCE 2026-09-17 BECAUSE A SECOND HOST RENDERS
 * IT.** The landing page's hero demo (`features/marketing/components/banner-demo/`)
 * draws /home's channel column, and the Next tree cannot import `apps/` at all —
 * so three re-typed labels in the marketing scene would be the drift this whole
 * module exists to prevent. `channel-wells.ts` re-exports both constants, so
 * every SPA import path is unchanged. **Nothing about the set changed in the
 * move.**
 *
 * ⚠ **THE 24h CUT IS `recency-wells.tsx › wellFor`, BY IMPORT FROM
 * `channel-wells.ts`, AND THERE IS NO SECOND CLOCK.**
 */

import type { WellSpec } from "./well-state";

/**
 * THIS SURFACE'S PERSISTED OPEN STATE. ⚠ **ITS OWN KEY** — not the Agents tab's
 * `dopl.agents.wells` and not the Threads tab's `dopl.threads.wells`: collapsing
 * **Earlier** over a channel list is not a statement about either tab.
 */
export const HOME_CHANNEL_WELLS_KEY = "dopl.home.channels.wells";

/**
 * THE THREE WELLS, IN SAMUEL'S ORDER. ⚠ **ORDER IS THE DATA** — the render maps
 * this array.
 *
 * ⚠ **PINNED AND RECENT OPEN, EARLIER CLOSED.** **The closed Earlier is the one
 * part of this Samuel did not state** — it is the Agents tab's default carried
 * over, and it means a list whose every channel has been quiet for 24h opens with
 * nothing visible. Flagged, not assumed; a device that opens it once never sees it
 * closed again (`well-state.ts › useWells`).
 */
export const HOME_CHANNEL_WELLS = [
  { id: "pinned", label: "Pinned", defaultOpen: true },
  { id: "recent", label: "Recent", defaultOpen: true },
  { id: "earlier", label: "Earlier", defaultOpen: false },
] as const satisfies readonly WellSpec[];

export type HomeChannelWellId = (typeof HOME_CHANNEL_WELLS)[number]["id"];
