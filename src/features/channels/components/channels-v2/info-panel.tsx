"use client";

/**
 * Channels v2 — RIGHT COLUMN: the channel's tabs. Info (`info-tab.tsx`),
 * Threads (`threads-tab.tsx`), Agents (`agents-tab.tsx`) and Links, which is a
 * deliberate empty state.
 *
 * ⚠ Files left this row on 2026-08-18 — where a channel's files land is still
 * an OPEN QUESTION (wiring plan, Risk 10), and an empty tab was answering it
 * with "here".
 *
 * Local state: the active tab, and nothing else. The center pane's open thread,
 * the open AGENT and the mentions read-state are all lifted to
 * `channels-v2-core.tsx`, since this column SETS them and other surfaces read
 * them back.
 */

import { useState } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { InfoTab } from "./info-tab";
import { ThreadsTab } from "./threads-tab";
import { AgentsTab } from "./agents-tab";
import type { FixtureMention } from "./fixtures-mentions";
import type { AuthorIndex } from "./view-model";
import type { Channel, ChannelMember, ChannelThread } from "../../types";

const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "links", label: "Links" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function ChannelsV2InfoPanel({
  channel,
  channelName,
  members,
  threads,
  threadsTruncated,
  threadsLoading,
  index,
  openThreadId,
  onOpenThread,
  openAgent,
  onOpenAgent,
  readMentions,
  onOpenMention,
  onMarkAllMentionsRead,
}: {
  channel: Channel;
  channelName: string;
  members: ChannelMember[];
  /** THE WHOLE bounded list, in the server's activity order — the Threads tab
   *  lists everything, unlike the sidebar's 24h window. */
  threads: ChannelThread[];
  threadsTruncated: boolean;
  threadsLoading: boolean;
  index: AuthorIndex;
  openThreadId: string | null;
  onOpenThread: (id: string) => void;
  /** The agent whose view is open — read only to mark its card "Viewing". The
   *  panel itself renders at page level, over this column. */
  openAgent: string | null;
  onOpenAgent: (id: string) => void;
  /** The Tags inbox's read-state — lifted, the badge derives from it. */
  readMentions: ReadonlySet<string>;
  onOpenMention: (mention: FixtureMention) => void;
  onMarkAllMentionsRead: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("info");

  return (
    <aside
      aria-label="Channel info"
      className="flex w-[340px] shrink-0 flex-col border-l border-border-default"
    >
      <div className="flex h-[56px] shrink-0 items-center border-b border-border-default px-3">
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </div>

      {tab === "info" ? (
        <InfoTab
          channel={channel}
          channelName={channelName}
          members={members}
          threadCount={threads.length}
          readMentions={readMentions}
          onOpenMention={onOpenMention}
          onMarkAllMentionsRead={onMarkAllMentionsRead}
        />
      ) : tab === "threads" ? (
        <ThreadsTab
          threads={threads}
          truncated={threadsTruncated}
          loading={threadsLoading}
          index={index}
          openThreadId={openThreadId}
          onOpenThread={onOpenThread}
        />
      ) : tab === "agents" ? (
        <AgentsTab openAgent={openAgent} onOpenAgent={onOpenAgent} />
      ) : (
        <p className="px-4 py-8 text-center text-caption text-text-muted">
          No links in this channel yet.
        </p>
      )}
    </aside>
  );
}
