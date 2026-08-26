/**
 * Channels v2 — the HARDCODED design furniture that survived the port.
 *
 * ⚠ Samuel's ruling, 2026-08-18 (wiring plan § Risks 9; fourth round of the
 * port's intent doc, deleted at the Phase 12 cutover — the live statement is
 * INVARIANTS §5's hardcoded-furniture bullet): the activity heatmap,
 * Linked threads and the
 * Assistant / Drafts / Saved-items nav rows keep their mock UI through the
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

/**
 * HARDCODED — no backing data yet (Samuel 2026-08-18).
 * "Linked threads" is a relationship the schema does not hold: a thread belongs
 * to one channel and links to nothing.
 */
export const HARDCODED_LINKED_THREADS: Array<{ label: string; badge?: number }> = [
  { label: "Front-end", badge: 4 },
  { label: "UI-kit design standards" },
];

/**
 * HARDCODED — no backing data yet (Samuel 2026-08-18).
 *
 * Thread-activity heatmap, one entry per recent slice, `0`–`4` = how busy.
 * Hand-authored so the strip reads like real traffic rather than noise. There
 * is no per-slice activity projection anywhere — the `channel_tasks_activity`
 * view carries ONE timestamp per thread, not a histogram.
 */
export const HARDCODED_THREAD_ACTIVITY: number[] = [
  1, 0, 2, 1, 3, 2, 1, 0, 2, 3, 4, 4, 3, 2, 4, 3, 1, 2, 0, 1, 3, 4, 2, 1,
];

/** "Diana Taylor" → "Diana's agent". THE label form for an addressed agent —
 *  the composer's pills read it. */
export function agentLabel(displayName: string | null): string {
  return `${(displayName ?? "Member").split(" ")[0]}'s agent`;
}
