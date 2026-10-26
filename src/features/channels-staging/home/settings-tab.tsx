"use client";

/**
 * The info column's Settings tab on staging: the PRODUCT's views (`settings-tab.tsx ›
 * ChannelsSettingsTab`, `settings-agent.tsx › ChannelAgentSettingsView`,
 * `settings-channel-agents.tsx › ChannelAgentsSettings`, `thread-settings-tab.tsx`) over local
 * state. Only the hosts are stood in: `channel-manage.tsx` / `thread-manage.tsx` and the
 * settings container hold live writes and the desktop bridge, which staging must never call.
 * The launch record is `settings-staging`'s in-memory stub; `memberManagement` is off, as on
 * /home (Add members and Delete channel stay hidden there).
 */

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { GoPublicDialog } from "@/features/channels/components/go-public-dialog";
import { ChannelAgentSettingsView } from "@/features/channels/components/settings-agent";
import { ChannelAgentsSettings } from "@/features/channels/components/settings-channel-agents";
import { ChannelsSettingsTab } from "@/features/channels/components/settings-tab";
import { ChannelsThreadSettingsTab } from "@/features/channels/components/thread-settings-tab";
import { canManageChannelHere } from "@/features/channels/lib/channel-manage-gate";
import type {
  AgentToolProfile,
  Channel,
  ChannelMember,
  ChannelThread,
} from "@/features/channels/types";
import { useLaunchSelection } from "@/features/settings-staging/stubs/use-launch-selection";

const DEFAULT_FOLDER = "~/Dopl";
const noop = () => {};

function useFlag(initial: boolean) {
  const [on, setOn] = useState(initial);
  return { on, busy: false, onToggle: setOn };
}

function ChannelSettings({
  channel,
  members,
  currentUserId,
}: {
  channel: Channel;
  members: readonly ChannelMember[];
  currentUserId: string;
}) {
  const selection = useLaunchSelection({ kind: "channel", channelId: channel.id });
  const [profile, setProfile] = useState<AgentToolProfile>("full");
  const [folder, setFolder] = useState<string | null>(`~/Code/${channel.name}`);
  const [roster, setRoster] = useState(members);
  const [visibility, setVisibility] = useState(channel.visibility);
  const [goPublic, setGoPublic] = useState(false);
  const agentChain = useFlag(true);
  const useMyTools = useFlag(false);
  const orchestrator = useFlag(false);
  const orchestratorDirect = useFlag(false);

  return (
    <>
      <ChannelsSettingsTab
        channel={{ ...channel, visibility }}
        canManage={canManageChannelHere(channel, channel.myWorkspaceRole ?? "member")}
        isChannelOwner={channel.role === "owner"}
        memberManagement={false}
        agent={
          <ChannelAgentSettingsView
            profile={profile}
            onSetToolProfile={setProfile}
            toolProfileBusy={false}
            roster={roster}
            currentUserId={currentUserId}
            memberCount={channel.memberCount}
            selection={selection}
            folder={{
              label: folder ?? DEFAULT_FOLDER,
              custom: folder !== null,
              busy: false,
              onChoose: () => setFolder(`~/Code/${channel.name}`),
              onClear: () => setFolder(null),
            }}
            agentChain={agentChain}
            useMyTools={useMyTools}
            orchestrator={orchestrator}
            orchestratorDirect={orchestratorDirect}
          />
        }
        channelAgents={
          <ChannelAgentsSettings
            members={roster}
            currentUserId={currentUserId}
            onSetUnaddressedResponder={(setting) =>
              setRoster((rows) =>
                rows.map((m) => (m.userId === currentUserId ? { ...m, unaddressedResponder: setting } : m))
              )
            }
          />
        }
        onInvite={noop}
        onToggleVisibility={() =>
          visibility === "private" ? setGoPublic(true) : setVisibility("private")
        }
        onRequestDelete={noop}
        onRequestLeave={noop}
      />
      <GoPublicDialog
        open={goPublic}
        onOpenChange={setGoPublic}
        displayName={channel.name}
        onConfirm={() => setVisibility("public")}
      />
    </>
  );
}

function ThreadSettings({
  channel,
  thread,
  currentUserId,
}: {
  channel: Channel;
  thread: ChannelThread;
  currentUserId: string;
}) {
  const [mode, setMode] = useState(thread.mode);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canSetMode = thread.createdBy === currentUserId;
  return (
    <>
      <ChannelsThreadSettingsTab
        thread={{ ...thread, mode }}
        canSetMode={canSetMode}
        canDelete={canSetMode || canManageChannelHere(channel, channel.myWorkspaceRole ?? "member")}
        onSetMode={setMode}
        onRequestDelete={() => setConfirmDelete(true)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete thread?"
        description={`"${thread.title}" and all its messages will be permanently deleted for everyone in this channel. This can't be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={noop}
      />
    </>
  );
}

/** The Settings tab body: the thread face while a thread is open, else the channel face. */
export function StagingSettingsTab({
  channel,
  members,
  thread,
  currentUserId,
}: {
  channel: Channel;
  members: readonly ChannelMember[];
  thread: ChannelThread | null;
  currentUserId: string;
}) {
  if (thread) {
    return (
      <ThreadSettings key={thread.id} channel={channel} thread={thread} currentUserId={currentUserId} />
    );
  }
  return (
    <ChannelSettings
      key={channel.id}
      channel={channel}
      members={members}
      currentUserId={currentUserId}
    />
  );
}
