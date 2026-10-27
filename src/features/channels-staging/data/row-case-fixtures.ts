/**
 * Two channels with no topic, so the column shows every row case side by side: a solo one
 * ("Just you") and a peopled one ("with Grace"). Invented; the demo lists neither.
 */

import { U, activityOf, channelOf, membersOf, minsAgo, postsFor } from "./staging-builders";
import type { ChannelFixture } from "./staging-fixture-types";

const CREATED = minsAgo(60 * 24 * 9);

function bareFixture(
  id: string,
  name: string,
  people: readonly string[],
  posts: ReadonlyArray<[author: string, body: string, minutesAgo: number]>,
  marks: Pick<ChannelFixture, "unread">
): ChannelFixture {
  const post = postsFor(id, id);
  return {
    kind: "channel",
    rowId: `rel:${id}`,
    well: "recent",
    mentionsPill: 0,
    favorited: false,
    ...marks,
    channel: channelOf(id, name, people.length, { createdAt: CREATED }),
    members: membersOf(id, people),
    messages: posts.map(([author, body, ago]) => post(author, body, ago, { device: "computer" })),
    threads: [],
    sessions: [],
    peers: [],
    serverSessions: [],
    mentions: [],
    narration: {},
    activity: activityOf([0, 0, 1, 0, 0, 0, 2, 0, 0, 1]),
  };
}

export function scratchpadFixture(): ChannelFixture {
  return bareFixture(
    "stg-ch-scratch",
    "scratchpad",
    [U.samuel],
    [[U.samuel, "notes for the 1.43 changelog go here", 60 * 3]],
    { unread: false }
  );
}

export function launchPlanFixture(): ChannelFixture {
  return bareFixture(
    "stg-ch-launch",
    "launch-plan",
    [U.samuel, U.grace],
    [
      [U.grace, "draft of the launch checklist is in the doc", 60 * 2],
      [U.samuel, "thanks, reading it tonight", 60 * 1.5],
    ],
    { unread: true }
  );
}
