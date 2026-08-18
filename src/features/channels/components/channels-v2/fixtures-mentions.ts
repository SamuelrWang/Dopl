/**
 * Channels v2 — MENTIONS-OF-ME fixtures for the Info tab's Tags inbox.
 *
 * ⚠ HARDCODED — no backing data yet (Samuel 2026-08-18). The Tags inbox is
 * wired in Phase 6 of the wiring plan, and it needs two things that do not
 * exist: mention/tag addressing of the OPERATOR (parsed, then server-stamped
 * into reserved metadata) and a READ-STATE column, which
 * `channel_messages` has none of (MAPPING.md § the Tags row). The fixture stays
 * so the designed inbox remains visible, and its read-state stays page state —
 * correct for a fixture, wrong for the product.
 *
 * ⚠ Each row carries a `messageId` because the inbox's whole interaction is
 * mark-read → navigate → SCROLL, and the transcript's scroll plumbing is real
 * (`data-message-id` + a nonced target). These ids belong to no real message,
 * so the scroll lands nowhere until Phase 6 replaces this file; the mark-read,
 * the badge and the disclosure are live.
 */

import type { AvatarPerson } from "@/shared/ui/avatar";

function person(id: string, displayName: string): AvatarPerson {
  return { userId: id, email: null, displayName, avatarUrl: null };
}

const DIANA = person("fixture-diana", "Diana Taylor");
const DANIEL = person("fixture-daniel", "Daniel Anderson");

export interface FixtureMention {
  id: string;
  /** The message row this mention lives in — the scroll target. */
  messageId: string;
  /** Thread id, or `null` for the channel transcript — the navigate target. */
  threadId: string | null;
  author: AvatarPerson;
  authorLabel: string;
  /** Display claim only, same rule as the transcript's chip (INVARIANTS §5). */
  agent?: boolean;
  time: string;
  /** Preview text, clamped in the list; the transcript row is the record. */
  snippet: string;
  /** Seeds the page's read-state once; never read again after mount. */
  initiallyUnread: boolean;
}

export const FIXTURE_MENTIONS: FixtureMention[] = [
  {
    id: "men-qa",
    messageId: "fixture-q2",
    threadId: null,
    author: DIANA,
    authorLabel: "Diana T.",
    agent: true,
    time: "9m ago",
    snippet:
      "I'll need your call on the two legacy greys before the list lands — replace them or tokenize them as-is?",
    initiallyUnread: true,
  },
  {
    id: "men-diana-channel",
    messageId: "fixture-m7",
    threadId: null,
    author: DIANA,
    authorLabel: "Diana T.",
    time: "8m ago",
    snippet:
      "The updated kit review page is ready for your pass — flagging it before the freeze so nothing lands after.",
    initiallyUnread: true,
  },
  {
    id: "men-uikit",
    messageId: "fixture-t5",
    threadId: null,
    author: DIANA,
    authorLabel: "Diana T.",
    agent: true,
    time: "1h ago",
    snippet:
      "Disabled faces are published — date field and drop zone are both in the v3.0 file. Both faces are in, ready for your freeze.",
    initiallyUnread: true,
  },
  {
    // Already read — stays in the list, unmarked, so the inbox is a record and
    // not just a to-do pile.
    id: "men-daniel",
    messageId: "fixture-m3",
    threadId: null,
    author: DANIEL,
    authorLabel: "Daniel A.",
    time: "3h ago",
    snippet:
      "Can you confirm the button specs are final before Thursday? Layers are organized, waiting on your word.",
    initiallyUnread: false,
  },
];

/** Read-state seed for the page: everything not initially unread. */
export const INITIALLY_READ_MENTIONS: ReadonlySet<string> = new Set(
  FIXTURE_MENTIONS.filter((m) => !m.initiallyUnread).map((m) => m.id)
);
