/**
 * Channels v2 — MENTIONS-OF-ME fixtures for the Info tab's Tags inbox.
 *
 * Each row POINTS AT a real rendered message (`messageId` + where it lives), so
 * clicking one can navigate the center pane and scroll the transcript to the
 * exact row — the snippet is a preview, never a second copy of the record.
 *
 * Read/unread is PAGE STATE, not fixture state: `initiallyUnread` seeds it and
 * the page owns it from there (index.tsx). At port time read-state needs a home
 * the server does not have today — see MAPPING.md § the Tags row.
 */

import type { AvatarPerson } from "@/shared/ui/avatar";
import { CHANNEL_TITLE, PEOPLE } from "./mock-data";
import { THREADS } from "./mock-threads";

export interface MockMention {
  id: string;
  /** The `MockMessage.id` this mention lives in — the scroll target. */
  messageId: string;
  /** Thread id, or `null` for the channel transcript — the navigate target. */
  threadId: string | null;
  author: AvatarPerson;
  authorLabel: string;
  /** Display claim only, same rule as the transcript's chip. */
  agent?: boolean;
  time: string;
  /** Preview text, clamped in the list; the transcript row is the record. */
  snippet: string;
  /** Seeds the page's read-state once; never read again after mount. */
  initiallyUnread: boolean;
}

export const MENTIONS: MockMention[] = [
  {
    id: "men-qa",
    messageId: "q2",
    threadId: "qa-sweep",
    author: PEOPLE.diana,
    authorLabel: "Diana T.",
    agent: true,
    time: "9m ago",
    snippet:
      "I'll need your call on the two legacy greys before the list lands — replace them or tokenize them as-is?",
    initiallyUnread: true,
  },
  {
    id: "men-diana-channel",
    messageId: "m7",
    threadId: null,
    author: PEOPLE.diana,
    authorLabel: "Diana T.",
    time: "8m ago",
    snippet:
      "The updated kit review page is ready for your pass — flagging it before the freeze so nothing lands after.",
    initiallyUnread: true,
  },
  {
    id: "men-uikit",
    messageId: "t5",
    threadId: "uikit",
    author: PEOPLE.diana,
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
    messageId: "m3",
    threadId: null,
    author: PEOPLE.daniel,
    authorLabel: "Daniel A.",
    time: "3h ago",
    snippet:
      "Can you confirm the button specs are final before Thursday? Layers are organized, waiting on your word.",
    initiallyUnread: false,
  },
];

/** Read-state seed for the page: everything not initially unread. */
export const INITIALLY_READ_MENTIONS: ReadonlySet<string> = new Set(
  MENTIONS.filter((m) => !m.initiallyUnread).map((m) => m.id)
);

/** "in UI-kit design" / "in # Website" — the item's location line. */
export function mentionLocation(threadId: string | null): string {
  if (threadId === null) return `# ${CHANNEL_TITLE}`;
  return THREADS.find((t) => t.id === threadId)?.title ?? "Unknown thread";
}
