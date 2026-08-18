/**
 * Channels v2 — the HARDCODED design furniture that survived the port.
 *
 * ⚠ Samuel's ruling, 2026-08-18 (wiring plan § Risks 9, MAPPING.md fourth
 * round): the activity heatmap, Linked threads, Favorites and the
 * Assistant / Drafts / Saved-items nav rows keep their mock UI through the
 * wiring. They have **no backing data of any kind** — not an empty table, not a
 * nullable column: nothing anywhere projects them. They are wired later as
 * their own work.
 *
 * The rule this file exists to make checkable: **a fixture feeding a WIRED
 * component is a bug; a fixture feeding a component marked
 * `// HARDCODED — no backing data yet (Samuel 2026-08-18)` is the ruling.**
 * Every export below has exactly one consumer and that consumer carries the
 * marker. Nothing here is read by the sidebar's channel list, the transcript,
 * the roster or the Threads tab — those are real.
 *
 * ⚠ Never render ZEROS from missing backing data instead: an empty heatmap and
 * an empty Favorites section are claims ("no activity", "nothing starred") that
 * no read established.
 */

import {
  Bookmark,
  FileText,
  Hash,
  Inbox,
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
 * ⚠ The INBOX row is NOT in this list. It is the consent inbox
 * (MAPPING.md § Q&A rulings, second round) and its badge is a real count off
 * `use-consent-inbox`, so the sidebar renders it separately rather than letting
 * it ride along with three rows that stand for nothing.
 */
export const HARDCODED_NAV_ROWS: NavRowSpec[] = [
  { id: "assistant", label: "Assistant", icon: Sparkles, isNew: true },
  { id: "drafts", label: "Drafts", icon: FileText },
  { id: "saved", label: "Saved items", icon: Bookmark },
];

/** The Inbox nav row's identity, kept beside its siblings so the section reads
 *  as one list in code the way it does on screen. */
export const INBOX_NAV_ROW: NavRowSpec = {
  id: "inbox",
  label: "Inbox",
  icon: Inbox,
};

/** A starred row in the Favorites section. */
export interface FavoriteRowSpec {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * HARDCODED — no backing data yet (Samuel 2026-08-18).
 * Favourites are a client-side preference with no column and no local store
 * (MAPPING.md § Sidebar).
 */
export const HARDCODED_FAVORITE_ROWS: FavoriteRowSpec[] = [
  { id: "fav-design", label: "Design system", icon: Hash },
  { id: "fav-release", label: "Release notes", icon: Hash },
];

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
