"use client";

/**
 * Channels v2 — RIGHT COLUMN: the channel's tabs. Info (`info-tab.tsx`),
 * Threads (`threads-tab.tsx`), Agents (`agents-tab.tsx`) and Settings, which is
 * the pane header's evicted action cluster (`channel-manage.tsx` →
 * `settings-tab.tsx`, injected as a slot for the same reason the panes take
 * theirs: it is write-bearing and this file owns the tab row only).
 *
 * ⚠ THE FOURTH TAB WAS **LINKS** UNTIL 2026-08-19, and it was a deliberate empty
 * state ("No links in this channel yet.") — Files had left the row on 2026-08-18
 * because where a channel's files land is still an OPEN QUESTION (wiring plan,
 * Risk 10) and an empty tab was answering it with "here". The same argument
 * retires Links: it renders nothing and reserves the answer. **Nothing was
 * rehomed out of it** — there was nothing in it.
 *
 * Local state: the active tab, and nothing else. The center pane's open thread,
 * the open AGENT and the mentions read-state are all lifted to
 * `channels-v2-core.tsx`, since this column SETS them and other surfaces read
 * them back.
 */

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { InfoTab } from "./info-tab";
import { ThreadsTab } from "./threads-tab";
import { AgentsTab } from "./agents-tab";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { AuthorIndex } from "./view-model";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelThread,
} from "../../types";

const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "settings", label: "Settings" },
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
  agentSessions,
  peerSessions = [],
  canLaunchAgent = false,
  launchBusy = false,
  onLaunchAgent,
  openAgent,
  onOpenAgent,
  mentions,
  mentionsTruncated,
  mentionsLoading,
  onOpenMention,
  onMarkAllMentionsRead,
  settings,
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
  /** THIS MACHINE'S live session feed, or `null` for "could not ask" (a plain
   *  browser, or a main without it). ⚠ Passed through, never collapsed to `[]`:
   *  the Agents tab words the two cases differently. */
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** EVERY member's session STATE (server projection) — the peer cards. */
  peerSessions?: readonly ChannelPeerSession[];
  canLaunchAgent?: boolean;
  launchBusy?: boolean;
  onLaunchAgent?: (threadId: string) => void;
  /** `agentsModel › agentKey` of the agent whose view is open — read only to
   *  mark its card "Viewing". The panel itself renders at page level, over this
   *  column. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
  /** MY mentions in this channel — the Tags inbox's rows, each carrying its own
   *  `read` flag. ⚠ The unread BADGE is arithmetic over this list inside
   *  `InfoTab`, never a second count from anywhere. */
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
  /**
   * The SETTINGS tab's body — `channel-manage.tsx › ChannelsV2ManageActions`,
   * injected rather than imported because it is write-bearing and channel-scoped
   * and this file owns the tab row. ⚠ Mounted only while the tab is open, which
   * is deliberate: its three write hooks and four dialogs have no business being
   * live behind the Info tab.
   */
  settings?: ReactNode;
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
          mentions={mentions}
          mentionsTruncated={mentionsTruncated}
          mentionsLoading={mentionsLoading}
          index={index}
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
        <AgentsTab
          sessions={agentSessions}
          channelId={channel.id}
          openThreadId={openThreadId}
          members={members}
          currentUserId={index.currentUserId}
          peers={peerSessions}
          canLaunch={canLaunchAgent}
          launchBusy={launchBusy}
          onLaunchAgent={onLaunchAgent}
          openAgent={openAgent}
          onOpenAgent={onOpenAgent}
        />
      ) : (
        settings
      )}
    </aside>
  );
}
