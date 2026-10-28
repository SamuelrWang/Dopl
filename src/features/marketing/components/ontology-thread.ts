import { CHANNEL, type ChannelLine } from "./ontology-content";

/**
 * The Channels window's ONE clock: every feed line's slot, derived from
 * ./ontology-content.ts › CHANNEL.lines so copy edits never desync it. The
 * feed (./ontology-windows.tsx) and the agent rail (./ontology-agent-rail.tsx)
 * both read these slots, so a card's status flips on the same `--d` as the
 * post it describes.
 */
export const THREAD = { start: 400, read: 700, typing: 800, event: 500 } as const;

export type ThreadSlot = { at: number; typing?: number };

/** Agent messages get a typing row first; people and events just land. */
function scheduleThread(lines: readonly ChannelLine[]): ThreadSlot[] {
  let t = THREAD.start;
  return lines.map((line) => {
    if (line.kind === "event") {
      const slot = { at: t };
      t += THREAD.event;
      return slot;
    }
    if ("person" in line.from) {
      const slot = { at: t };
      t += THREAD.read;
      return slot;
    }
    const slot = { at: t + THREAD.typing, typing: t };
    t += THREAD.typing + THREAD.read;
    return slot;
  });
}

export const THREAD_SLOTS = scheduleThread(CHANNEL.lines);

/** Last beat of the channel window — the tour's meter fills over exactly this.
 *  ⚠ Every rail beat must land at or before it (pinned in
 *  ontology-section.test.tsx). */
export const CHANNEL_END_MS = THREAD_SLOTS[THREAD_SLOTS.length - 1].at + 500;
