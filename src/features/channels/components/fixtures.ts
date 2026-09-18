/**
 * Channels — the HARDCODED design furniture that survived the port.
 *
 * ⚠ Samuel's ruling, 2026-08-18 (wiring plan § Risks 9; fourth round of the
 * port's intent doc, deleted at the Phase 12 cutover — the live statement is
 * INVARIANTS §5's hardcoded-furniture bullet): the activity heatmap,
 * Linked threads and the
 * Assistant / Drafts / Saved-items nav rows kept their mock UI through the
 * wiring. They have **no backing data of any kind** — not an empty table, not a
 * nullable column: nothing anywhere projects them. They are wired later as
 * their own work.
 *
 * ⚠ FAVORITES LEFT THIS FILE ON 2026-08-19 (Samuel), and the shape of its
 * departure is the template for the ones still here: it did NOT get a fixture
 * replaced by a prettier fixture, it got a COLUMN (`channel_members.favorited_at`)
 * and a write. `HARDCODED_FAVORITE_ROWS` is deleted rather than kept "for
 * reference" — a fixture nothing renders is the next thing somebody renders.
 *
 * The rule this file exists to make checkable: **a fixture feeding a WIRED
 * component is a bug; a fixture feeding a component marked
 * `// HARDCODED — no backing data yet (Samuel 2026-08-18)` is the ruling.**
 * Every export below has exactly one consumer and that consumer carries the
 * marker. Nothing here is read by the sidebar's channel list, the transcript,
 * the roster or the Threads tab — those are real.
 *
 * ⚠ Never render ZEROS from missing backing data instead: an empty heatmap is a
 * claim ("no activity") that no read established. The Favorites section may now
 * render empty-and-absent precisely BECAUSE a read established it.
 */

import {
  Bookmark,
  FileText,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** A quiet nav row above the tree. */
export interface NavRowSpec {
  id: string;
  label: string;
  icon: LucideIcon;
  isNew?: boolean;
}

/**
 * HARDCODED — no backing data yet (Samuel 2026-08-18).
 *
 * ⚠ THE INBOX ROW WAS NOT IN THIS LIST BECAUSE IT WAS REAL, AND IT IS NOW
 * DELETED (Samuel, 2026-08-25 — see below). What is left here stands for
 * nothing, every row of it, which is the whole reason the two were separate.
 */
export const HARDCODED_NAV_ROWS: NavRowSpec[] = [
  { id: "assistant", label: "Assistant", icon: Sparkles, isNew: true },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "saved", label: "Saved items", icon: Bookmark },
];

// ⚠ `INBOX_NAV_ROW` STOOD HERE AND IS DELETED (Samuel, 2026-08-25). It was the
// one WIRED row in the sidebar's nav — the consent Inbox — and both the row and
// the pane behind it are gone: the outbound review is the work stream's card
// (`agent-stream.tsx › SentToChannelBox`), which a solo /home channel can reach
// and this nav never was.

// ⚠ `HARDCODED_LINKED_THREADS` STOOD HERE AND IS DELETED (Samuel's ruling R-45,
// 2026-09-17). "Linked threads" was a relationship the schema does not hold — a
// thread belongs to one channel and links to nothing — so the section it fed had
// no read to wait for and its rows had no `onClick`. It goes the way
// `HARDCODED_FAVORITE_ROWS` went, minus the column: deleted outright, not kept
// "for reference", because a fixture nothing renders is the next thing somebody
// renders.

/* ⚠ **`HARDCODED_THREAD_ACTIVITY` STOOD HERE AND IS DELETED (wave 1A, 2026-09-17
   — parity item X7).** 31 hand-authored heatmap levels, the last fixture feeding
   a shipped strip. F-316 wired /home's strip to a counted series on 2026-08-25
   and the workspace channels page on 2026-09-05, which left this array with ONE
   reader: its own test. INVARIANTS §15 — dead code is DELETED, not parked.
   ⚠ **NOTHING ABOUT THE ENCODING IS LOST.** `-1` = an empty well and `0`–`4`
   index `ACTIVITY_SHADE` low→high; that rule lives where it is executed
   (`thread-activity.tsx › activityLevels` / `› ActivityCells`) and is pinned
   there, not here. Reviving a fixture strip means reviving that reading too. */

/** "Diana Taylor" → "Diana's agent". THE label form for an addressed agent —
 *  the composer's pills read it. */
export function agentLabel(displayName: string | null): string {
  return `${(displayName ?? "Member").split(" ")[0]}'s agent`;
}
