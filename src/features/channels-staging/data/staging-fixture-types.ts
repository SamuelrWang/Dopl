/**
 * The shape one channel of the /channels staging page is built from: exactly the props the
 * landing demo's scene hands the product's `ChannelsMessagePane` / `ChannelsInfoPanel`
 * (`banner-demo/demo-scene.tsx`), plus the column row's own marks (`demo-home-rows.ts ›
 * HomeRowMock`).
 */

import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelMessage,
  ChannelThread,
} from "@/features/channels/types";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type {
  DesktopNarrationEntry,
  DesktopSessionSummary,
} from "@/shared/lib/spa-bridge";
import type { ActivityBin } from "@/features/channels/components/thread-activity";
import type { HomeChannelWellId } from "@/features/channels/components/home-channel-wells";
import type { ChannelPendingLink } from "@/features/channels/types-list";

export type ChannelFixture = {
  kind: "channel";
  /** `rel:`-prefixed column row id (the demo's ids where the demo has the row). */
  rowId: string;
  well: HomeChannelWellId;
  /** Landing-only "Invited" pill (`demo-home-rows.ts › HomeRowMock.invited`). */
  invited?: boolean;
  unread: boolean;
  /** The row's `@ N` pill. */
  mentionsPill: number;
  favorited: boolean;
  channel: Channel;
  members: ChannelMember[];
  messages: ChannelMessage[];
  threads: ChannelThread[];
  /** The viewer's own agents (the desktop feed). */
  sessions: DesktopSessionSummary[];
  /** Other members' agents, as the Agents tab lists them. */
  peers: ChannelPeerSession[];
  /** The server projection (every session, own included): colours + composer live set. */
  serverSessions: ChannelPeerSession[];
  mentions: ChannelMention[];
  /** agentId → the agent view's 1:1 lane. */
  narration: Record<string, DesktopNarrationEntry[]>;
  activity: readonly ActivityBin[];
};

/** An unclaimed link row (desktop `home-panes.tsx` mounts `PendingLinkCard` for it). */
export type LinkFixture = {
  kind: "link";
  rowId: string;
  well: HomeChannelWellId;
  name: string;
  link: ChannelPendingLink;
};

export type StagingRow = ChannelFixture | LinkFixture;
