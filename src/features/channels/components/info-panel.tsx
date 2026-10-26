"use client";

/**
 * The channel's right column: the tab row (Info, Threads, Agents, Tasks where the host offers it,
 * Settings) and its bodies.
 * With a thread open the column is thread-scoped; Settings arrives as a slot (`settings-slot.tsx`).
 */

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Crossfade } from "@/shared/ui/crossfade";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { InfoTab } from "./info-tab";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { ChannelInfoCardEdit } from "./info-card-rows";
import { ThreadInfoTab } from "./thread-info-tab";
import { ThreadsTab } from "./threads-tab";
import { ArtifactsTab } from "./artifacts-tab";
import { AgentsTab } from "./agents-tab";
import { activeAgentCount } from "./agents-model";
// Re-exported below so existing importers keep one path to each symbol.
import {
  channelPaneTabs,
  tabCount,
  threadsFaceOption,
  type TabKey,
} from "./info-panel-tabs";

export { channelPaneTabs };
export type { TabKey };
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import type { LaunchAgentFn } from "./use-launch-controls";
import type { AuthorIndex } from "./view-model";
import type {
  ChannelInfoExtras,
  MentionsLayout,
} from "./channel-surface-contract";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelThread,
} from "../types";

export function ChannelsInfoPanel({
  channel,
  channelName,
  activityBins = [],
  activityLoading = false,
  members,
  threads,
  threadsTruncated,
  threadsLoading,
  index,
  openThread,
  onOpenThread,
  onNewThread,
  agentSessions,
  peerSessions = [],
  canLaunchAgent = false,
  launchBusy = false,
  launchError = null,
  onLaunchAgent,
  onApproveIdentity,
  openAgent,
  onOpenAgent,
  mentions,
  mentionsTruncated,
  mentionsLoading,
  onOpenMention,
  onMarkAllMentionsRead,
  onJumpToMessage,
  artifacts = false,
  headerEdit,
  infoCardEdit,
  infoExtras,
  mentionsLayout,
  rosterEmptyLine,
  membersAction,
  infoTabSignal = 0,
  tasks,
  activeTaskCount,
  tasksTabSignal = 0,
  fullTab,
  settings,
}: {
  channel: Channel;
  channelName: string;
  /** Host-fetched messages-per-day; empty means no strip, not measured zeroes. */
  activityBins?: readonly { date: string; count: number }[];
  activityLoading?: boolean;
  members: ChannelMember[];
  /** The whole bounded list, in server activity order. */
  threads: ChannelThread[];
  threadsTruncated: boolean;
  threadsLoading: boolean;
  index: AuthorIndex;
  /** The open thread (not its id, so the two can't disagree); `null` is channel view. */
  openThread: ChannelThread | null;
  onOpenThread: (id: string) => void;
  /** Threads tab's "New thread"; absent draws no button. */
  onNewThread?: () => void;
  /** This machine's session feed, or `null` for "could not ask" — never collapsed to `[]`. */
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** Every member's session state (server projection). */
  peerSessions?: readonly ChannelPeerSession[];
  canLaunchAgent?: boolean;
  launchBusy?: boolean;
  launchError?: string | null;
  /** Branded `LaunchAgentFn`, passed through unwrapped: a narrower wrapper dropped agentId/runtime/colour (P6-01). */
  onLaunchAgent?: LaunchAgentFn;
  onApproveIdentity?: (identityId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** `agentKey` of the open agent view; only marks its card "Viewing". */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
  /** My mentions in this channel; the unread badge is derived from this list, never a second count. */
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
  /** Moves the transcript to a message (an opened artifact's); absent draws no jump. */
  onJumpToMessage?: (threadId: string | null, messageId: string) => void;
  /** The curated `channels.info_card` write, minted by the host; absent draws no rows. */
  infoCardEdit?: ChannelInfoCardEdit;
  /** Offer the Threads tab's Artifacts face (shares the slot: the row's width fits four tabs). */
  artifacts?: boolean;
  /** Click-to-edit name/description, resolved by the host; absent is display-only. Channel view only. */
  headerEdit?: ChannelHeaderEdit;
  /** Single-column mode: render this tab's body full width with no tab row. Absent is the column. */
  fullTab?: TabKey;
  /** Host additions to the Info tab (channel view only). */
  infoExtras?: ChannelInfoExtras;
  mentionsLayout?: MentionsLayout;
  rosterEmptyLine?: boolean;
  membersAction?: ReactNode;
  /** Settings body, mounted only while its tab is open (INVARIANTS §5); the slot picks channel vs thread. */
  settings?: ReactNode;
  /** Nonce: each change resets to Info. A nonce, so `tab` keeps one owner and "asked twice" resets twice. */
  infoTabSignal?: number;
  /** The Tasks tab's body; absent draws no Tasks tab. */
  tasks?: ReactNode;
  /** The Tasks badge: unresolved tasks in the loaded list. */
  activeTaskCount?: number;
  /** Counter: each rise switches to Tasks (the composer's quick view); 0 while nothing is asked. */
  tasksTabSignal?: number;
}) {
  const [tab, setTab] = useState<TabKey>("info");
  // Owned here: the tab label and the body both read it. Not persisted.
  const [artifactsFace, setArtifactsFace] = useState(false);
  const openThreadId = openThread?.id ?? null;
  const threadView = openThread !== null;
  const options = channelPaneTabs(threadView, tasks !== undefined);
  // The capability is ANDed in here only.
  const onArtifactsFace = artifacts && artifactsFace;
  const feeds = { sessions: agentSessions, peers: peerSessions };

  // Opening a thread removes the Threads tab; fall back to Info during render (not an effect, to avoid a broken frame).
  const dead = !options.some((t) => t.key === tab);
  if (dead) setTab("info");
  // Same render-time idiom for the reset nonce.
  const [seenTabSignal, setSeenTabSignal] = useState(infoTabSignal);
  const reset = infoTabSignal !== seenTabSignal;
  if (reset) {
    setSeenTabSignal(infoTabSignal);
    setTab("info");
  }
  // Seeded at 0, not the current value: the ask that opens a closed column arrives with this
  // panel's mount (`use-channels-selection.ts › openTask`), and closing the column zeroes it.
  const [seenTasksSignal, setSeenTasksSignal] = useState(0);
  const toTasks = tasks !== undefined && tasksTabSignal > seenTasksSignal;
  if (tasksTabSignal !== seenTasksSignal) {
    setSeenTasksSignal(tasksTabSignal);
    if (toTasks) setTab("tasks");
  }
  const activeTab: TabKey = toTasks ? "tasks" : dead || reset ? "info" : tab;

  // The shared `activeAgentCount`, never a local sum; `null` sessions ⇒ `undefined`, never `0`.
  const agentCount =
    agentSessions === null
      ? undefined
      : activeAgentCount(
          agentSessions,
          peerSessions,
          channel.id,
          index.currentUserId,
          openThreadId
        );

  // Rendered by both layouts; `shown` is the token `Crossfade` has on screen.
  const body = (shown: string) =>
          shown === "info" ? (
            openThread ? (
              <ThreadInfoTab
                thread={openThread}
                members={members}
                index={index}
                agentSessions={agentSessions}
                peerSessions={peerSessions}
              />
            ) : (
              <InfoTab
                channel={channel}
                channelName={channelName}
                activityBins={activityBins}
                activityLoading={activityLoading}
                members={members}
                mentions={mentions}
                mentionsTruncated={mentionsTruncated}
                mentionsLoading={mentionsLoading}
                mentionsLayout={mentionsLayout}
                index={index}
                onOpenMention={onOpenMention}
                onMarkAllMentionsRead={onMarkAllMentionsRead}
                headerEdit={headerEdit}
                infoCardEdit={infoCardEdit}
                rosterEmptyLine={rosterEmptyLine}
                membersAction={membersAction}
                extras={infoExtras}
              />
            )
          ) : shown === "threads" ? (
            <ThreadsTab
              threads={threads}
              truncated={threadsTruncated}
              loading={threadsLoading}
              index={index}
              feeds={feeds}
              openThreadId={openThreadId}
              onOpenThread={onOpenThread}
              onNewThread={onNewThread}
              artifactsFace={onArtifactsFace}
              onToggleFace={
                artifacts ? () => setArtifactsFace((v) => !v) : undefined
              }
              // Mounted with the face, so its reads only run when shown.
              artifacts={
                onArtifactsFace ? (
                  <ArtifactsTab
                    channelId={channel.id}
                    workspaceId={channel.workspaceId}
                    index={index}
                    feeds={feeds}
                    onJumpToMessage={onJumpToMessage}
                  />
                ) : undefined
              }
            />
          ) : shown === "agents" ? (
            <AgentsTab
              sessions={agentSessions}
              channelId={channel.id}
              workspaceId={channel.workspaceId}
              openThreadId={openThreadId}
              members={members}
              currentUserId={index.currentUserId}
              peers={peerSessions}
              canLaunch={canLaunchAgent}
              launchBusy={launchBusy}
              launchError={launchError}
              onLaunchAgent={onLaunchAgent}
              onApproveIdentity={onApproveIdentity}
              openAgent={openAgent}
              onOpenAgent={onOpenAgent}
            />
          ) : shown === "tasks" ? (
            tasks
          ) : (
            settings
          );

  if (fullTab) {
    return (
      <section
        aria-label="Channel info"
        className="flex min-w-0 flex-1 flex-col"
      >
        <Crossfade token={fullTab} className="flex min-h-0 flex-1 flex-col">
          {body}
        </Crossfade>
      </section>
    );
  }

  return (
    <aside
      aria-label="Channel info"
      // `--info-w` is the draggable width (`use-info-resize.ts`); `shrink-0` keeps the slide from reflowing.
      className="flex w-[var(--info-w,380px)] shrink-0 flex-col border-l border-border-default"
    >
      <div className="flex h-[56px] shrink-0 items-center px-3">
        <SegmentedControl
          options={options.map((t) => {
            // Badge dropped by face + slot, never by label text.
            const artifactsSlot = onArtifactsFace && t.key === "threads";
            const option = threadsFaceOption(t, onArtifactsFace);
            return artifactsSlot
              ? option
              : {
                  ...option,
                  count: tabCount(option.key, threads, agentCount, activeTaskCount),
                };
          })}
          value={activeTab}
          onChange={setTab}
          size="lg"
          variant="underline"
          // Layout only (the primitive's contract).
          className="min-w-0 flex-1 overflow-x-auto"
        />
      </div>

      {/* The body reads `shown`, not `activeTab`, so content doesn't swap mid-fade. */}
      <Crossfade token={activeTab} className="flex min-h-0 flex-1 flex-col">
        {body}
      </Crossfade>
    </aside>
  );
}
