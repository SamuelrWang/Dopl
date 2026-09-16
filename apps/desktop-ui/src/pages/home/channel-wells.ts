/**
 * /home's CHANNEL LIST, IN THREE GRAY WELLS — **Pinned / Recent / Earlier.**
 *
 * 🔒 **SAMUEL, 2026-09-15, verbatim:** *"look on the agents tab, there is the gray
 * box, for recents, 7 days, etc. I want to bring that over. Basically, one for
 * Pinned, one for Recents (this will be in effect channels with activity in the
 * last 24 hours), and Earlier."* **Three wells, not four** — he named the set, and
 * the 7-day / 30-day spans he did not name are the Agents tab's.
 *
 * ⚠ **THE 24h CUT IS `channels/components/recency-wells.tsx › wellFor`, BY
 * IMPORT, AND THERE IS NO SECOND CLOCK.** Samuel's *"activity in the last 24
 * hours"* is exactly that module's **Recent** span, so this file asks it rather
 * than declaring an `86_400_000` of its own — the day the span moves it moves on
 * all three surfaces at once. Everything the four-span answer calls `week`,
 * `month` or `earlier` collapses into this set's **Earlier**.
 *
 * ⚠ **AN UNDATABLE ROW IS `recent`, WHICH IS `wellFor`'s OWN DIRECTION AND NOT A
 * LOCAL CHOICE** (INVARIANTS §11 — UNKNOWN is not EMPTY). `Earlier` is the one
 * well that is CLOSED by default, so filing a row we could not date there would
 * hide a live channel on the strength of a field that failed to parse.
 *
 * ⚠ **A PINNED ROW IS IN `Pinned` AND IN NOTHING ELSE.** One row, one well, which
 * is what makes the three exhaustive and what stops a pinned channel reading as
 * two channels.
 *
 * 🔒 ⚠ **PINNED MEANS FAVOURITED, AND THE PIN IS THE BOOKMARK (Samuel,
 * 2026-09-15):** *"remove the pin icon that appears when i hover over the picker.
 * instead replace the bookmark icon next to the channel name with the pin icon."*
 * `HomeChannel.favoritedAt` — `channel_members.favorited_at`, written by the
 * channel header's own toggle. ⚠ **THE PER-DEVICE `localStorage` SET THIS FILE
 * READ FOR ONE AFTERNOON IS DELETED. Do not mint a second pin store.**
 */

import { wellFor } from "@/features/channels/components/recency-wells";
import type { WellSpec } from "@/features/channels/components/well-state";
import type { HomeRow } from "./home-rows";

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

/**
 * THE ROW'S STAMP AS EPOCH MS, OR `null` WHEN IT DOES NOT PARSE.
 *
 * ⚠ **`HomeRow.at` IS AN ISO STRING, NOT A NUMBER** (`home-rows.ts` sorts on
 * `localeCompare`), and `null` IS NEVER ZERO (INVARIANTS §11): a `NaN` fed to
 * `wellFor` compares false against every ceiling and files the row under
 * **Earlier**, which is a fabricated fact about when the channel last spoke.
 */
function rowStamp(at: string): number | null {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * WHICH WELL A ROW SITS IN — a pin first, then the 24h cut.
 *
 * ⚠ **PENDING LINK ROWS ARE FILED BY THEIR `at` LIKE ANY CHANNEL** and can never
 * be pinned — a link has no channel yet, so there is no membership row to carry a
 * `favorited_at`. The `kind` test below is that fact, not a policy.
 * ⚠ **`now` IS A PARAMETER WITH A DEFAULT**, so a test can state an age instead of
 * arranging for one; the render passes nothing. The default is `wellFor`'s, on the
 * pure function, not a `Date.now()` in a component body (`react-hooks/purity`).
 */
export function channelWellOf(row: HomeRow, now?: number): HomeChannelWellId {
  // ⚠ `?? null` INLINE AT A NEW CACHED KEY (INVARIANTS §8): `favoritedAt` is new
  // on an IndexedDB-persisted payload with a 24h `gcTime`, so the first paint
  // after this bundle ships reads entries that DO NOT HAVE IT. `null` is the
  // fail-safe — the row files under its own recency, which is the answer that was
  // true for every row before the field existed.
  if (row.kind === "channel" && (row.channel.favoritedAt ?? null) !== null) {
    return "pinned";
  }
  return wellFor(rowStamp(row.at), now) === "recent" ? "recent" : "earlier";
}
