/**
 * Shared fixtures for `transcript-filter.test.tsx` (the RULE) and
 * `transcript-filter-menu.test.tsx` (the CONTROL) — split 2026-09-16 at the 500-line
 * cap, when the filter became multi-select and the menu grew a case per tick.
 *
 * ⚠ ONE TRANSCRIPT, SPENT BY BOTH HALVES. The whole point of these rows is that they
 * carry every population `agent-box-rule.ts › agentBoxOf` distinguishes — a live agent,
 * an ENDED one, a channel-less Desktop agent, two humans and an agent-opened thread
 * card. A second copy in the second file would drift the day one of those rules moves,
 * and each half would still pass.
 */

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { indexMembers } from "./view-model";
import { channelRows } from "./view-model-rows";
import { CHANNEL_ID, ME, PEER, member, message, thread } from "./test-fixtures";
import { TRANSCRIPT_FILTER_PEOPLE, type TranscriptFilter } from "./transcript-filter";
import type { AgentRosterEntry } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type { ChannelMessage } from "../types";

/** LIVE, wearing a colour. */
export const SCOUT = "k3v7d2mq";
/** ENDED — its key is back in the bank, so its posts wear the NEUTRAL box. */
export const ROVER = "a1b2c3d4";
/** In the machine's index and has posted NOTHING in this room. */
export const IDLE = "z9y8x7w6";

export const AGENTS: ReadonlyMap<string, AgentRosterEntry> = new Map([
  [SCOUT, { displayName: "Scout", description: null, ended: false, color: "agent-03" }],
  [ROVER, { displayName: "Rover", description: null, ended: true, color: null }],
  [IDLE, { displayName: "Idle hands", description: null, ended: false, color: "agent-07" }],
]);

export const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];
export const INDEX = indexMembers(MEMBERS, ME, AGENTS);

/**
 * An AGENT post. ⚠ `id === null` is the **"Desktop agent"** case and the reason this
 * helper takes a nullable: an MCP write from a session that belongs to no channel
 * carries no instance id, which is exactly the population Samuel put on the PEOPLE side
 * (`agent-box-rule.ts › agentBoxOf`). The session-key shape is
 * `lib/agent-post-stamp.ts › agentIdOfSessionKey`'s.
 */
function byAgent(id: string | null, over: Partial<ChannelMessage>): ChannelMessage {
  return message({
    authorKind: "agent",
    metadata: id === null ? {} : { session_id: `${CHANNEL_ID}::${id}` },
    ...over,
  });
}

export const THREAD = thread({ id: "t-1", title: "UI-kit design" });

export const MESSAGES: ChannelMessage[] = [
  message({ id: "m-1", seq: 1, body: "sam line" }),
  byAgent(SCOUT, { id: "m-2", seq: 2, body: "scout line" }),
  byAgent(ROVER, { id: "m-3", seq: 3, body: "rover line" }),
  byAgent(null, { id: "m-4", seq: 4, body: "desktop line" }),
  byAgent(SCOUT, { id: "m-5", seq: 5, body: "scout again" }),
  message({ id: "m-6", seq: 6, authorUserId: PEER, body: "diana line" }),
  // ⚠ A THREAD CARD OPENED BY AN AGENT — the "threads follow the same author rule" case.
  byAgent(SCOUT, {
    id: "m-7",
    seq: 7,
    body: "opened a thread",
    metadata: { session_id: `${CHANNEL_ID}::${SCOUT}`, taskId: THREAD.id },
  }),
];

export const ROWS = channelRows(MESSAGES, [THREAD], INDEX, formatChannelTimestamp);

/** People alone — the keyword both halves lean on. */
export const PEOPLE: TranscriptFilter = TRANSCRIPT_FILTER_PEOPLE;

/** A row's body, or its KIND in brackets for the rows that are not somebody's words —
 *  so a case that drops a card fails on the card rather than on a length. */
export const bodies = (rows: readonly TranscriptRow[]) =>
  rows.map((row) => (row.kind === "message" ? row.body : `[${row.kind}]`));
