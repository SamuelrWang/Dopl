"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MessageSquareOff } from "lucide-react";
import type { DesktopNarrationEntry, DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelMessage } from "@/features/channels/types";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type { AgentWindowTab } from "@/shared/lib/spa-bridge-window";
import { toast } from "@/shared/ui/toast";
import { EmptyState } from "@/shared/ui/empty-state";
import { indexMembers } from "@/features/channels/components/view-model";
import { LaunchAgentDialog } from "@/features/channels/components/launch-agent-dialog";
import type { AgentLaunchPanel } from "@/features/channels/components/use-agent-launch";
import { agentColorOrNull } from "@/shared/lib/agent-colors";
import { cn } from "@/shared/lib/utils";
import { StagingChannelScene } from "@/features/channels-staging/home/channel-scene";
import { AgentWorkingOn } from "@/features/channels/components/agent-window";
import { AgentHeldGates } from "@/features/channels/components/agent-held-gate";
import { PostureControls } from "@/features/channels/components/agent-posture";
import { AgentStats } from "@/features/channels/components/agent-stats";
import { AgentStream } from "@/features/channels/components/agent-stream";
import { splitEndNote } from "@/features/channels/components/agent-stream-lanes";
import { agentSentMessages } from "@/features/channels/components/agent-panel";
import { useAgentIdentity } from "@/features/channels/components/agent-face";
import {
  agentDisplayName,
  agentLiveness,
  postDestination,
} from "@/features/channels/components/agents-model";
import { COMPOSER_BOTTOM, ComposerInputRow } from "@/features/channels/components/composer-input";
import { useStagingChannels } from "@/features/channels-staging/store/use-staging-channels";
import { initialRows } from "@/features/channels-staging/data/staging-rows";
import { seedChannel, stagingQueryClient } from "@/features/channels-staging/data/staging-query-seed";
import {
  stagingAgentIndex,
  stagingOwnerPhoto,
} from "@/features/channels-staging/data/staging-agents";
import { CURRENT_USER_ID, VIEWER } from "@/features/channels-staging/data/demo-imports";

/**
 * STUBS of what the thread-window and agent-window pages import from the channels feature and the
 * window bridge. The window CHROME (shell, tabs, rail) is real. The BODIES are product parts on
 * the /channels staging store (`useStagingChannels`): the thread window is its record pane
 * (`StagingChannelScene`, `chrome="window"`, held on one thread), the agent window the product
 * body's parts (`ChannelsAgentWindow` below). The agent window's "+" draws the product's
 * `LaunchAgentDialog` on that store's launch controls, the same pair /channels' composer uses.
 *
 * One store per open window (`StagingChannelWindowsProvider`, mounted by
 * `staging-popups.tsx › StagingWindow`), on the demo channel the window route names
 * (`desktop-shell.tsx › STAGING_WINDOW_ROUTE`). Closing the window resets it.
 */

type WindowStore = ReturnType<typeof useStagingChannels>;
const WindowStoreContext = createContext<WindowStore | null>(null);

function useWindowStore(): WindowStore {
  const store = useContext(WindowStoreContext);
  if (!store) throw new Error("popups-staging: a channel window body rendered outside StagingChannelWindowsProvider");
  return store;
}

/** STAGING ONLY — the channels store + seeded QueryClient a staged window body reads. */
export function StagingChannelWindowsProvider({ children }: { children: ReactNode }) {
  const [qc] = useState(() => stagingQueryClient(initialRows()));
  const store = useStagingChannels((id) => seedChannel(qc, id));
  return (
    <QueryClientProvider client={qc}>
      <WindowStoreContext.Provider value={store}>{children}</WindowStoreContext.Provider>
    </QueryClientProvider>
  );
}

/** `@/features/channels/components/use-desktop-sessions › useDesktopSessions` — this machine's own
 *  agents across every staged channel (the launch dialog's new agents land here too). */
export function useDesktopSessions() {
  const store = useWindowStore();
  const sessions = useMemo(
    () => store.rows.flatMap((r) => (r.kind === "channel" ? r.sessions : [])),
    [store.rows]
  );
  return { sessions, refresh: () => {} };
}

/** `@/features/channels/components/agents-controls › canLaunchAgents / openAgentWindow`. */
export function canLaunchAgents(): boolean {
  return true;
}
export async function openAgentWindow(
  route: { channelId: string; threadId: string; agentId?: string },
  _segment: string
) {
  toast({ title: `Staging: would open the agent in ${route.channelId}` });
}

/** `@/shared/lib/spa-bridge-window › canHostAgentTabs / closeOwnTab / onAgentWindowTabs`. */
export function canHostAgentTabs(): boolean {
  return true;
}
export async function closeOwnTab(_key: string): Promise<void> {
  toast({ title: "Staging: would close this tab" });
}
export function onAgentWindowTabs(
  _listener: (payload: { tabs: readonly AgentWindowTab[]; focusKey?: string }) => void
): () => void {
  return () => {};
}
export type { AgentWindowTab };

/**
 * `@/features/channels/components/thread-window › ChannelsThreadWindow` — the product message
 * pane with `chrome="window"` (titled by the thread), on the /channels staging store, held on one
 * thread (`?thread=`), Info closed. Posting, the agent view and the thread's cards work as on
 * /channels.
 */
export function ChannelsThreadWindow({
  threadId,
}: {
  workspaceId: string;
  channelId: string;
  threadId: string | null;
  currentUserId: string;
}) {
  const store = useWindowStore();
  const fixture = store.fixture;
  const thread = fixture?.threads.find((t) => t.id === threadId) ?? null;
  if (!fixture || !thread) {
    return (
      <div className="page-float flex flex-col antialiased">
        <EmptyState
          icon={MessageSquareOff}
          title="That thread isn't here"
          description="It may have been deleted, or it is older than this channel's loaded history. Open the channel in the main window to find it."
        />
      </div>
    );
  }
  return (
    <div className="page-float relative flex antialiased">
      <StagingChannelScene
        chrome="window"
        fixture={fixture}
        thread={thread}
        openAgentKey={store.openAgentKey}
        infoOpen={false}
        scrollTarget={store.scrollTarget}
        actions={{ ...store.actions, exitThread: () => {}, openThread: () => {} }}
        agentsVersion={store.agentsVersion}
      />
    </div>
  );
}

/**
 * `@/features/channels/components/agent-window › ChannelsAgentWindow` — the product window body's
 * parts in the product's order (`AgentWorkingOn`, `PostureControls` with `AgentStats`,
 * `AgentHeldGates`, `AgentStream`), over /channels staging's session for the active tab. The one
 * stand-in is the composer: the product `AgentComposer` reaches main's `sessions.message`, so this
 * mounts its input row on the store's in-memory 1:1 send (with the canned reply).
 */
export function ChannelsAgentWindow({
  channelId,
  threadId,
  agentId,
}: {
  workspaceId: string;
  channelId: string;
  threadId: string;
  agentId: string | null;
  currentUserId: string;
}) {
  const store = useWindowStore();
  const fixture = store.rows.find(
    (r) => r.kind === "channel" && r.channel.id === channelId
  );
  const channel = fixture?.kind === "channel" ? fixture : null;
  const agent =
    channel?.sessions.find(
      (s) => s.threadId === threadId && (!agentId || s.agentId === agentId)
    ) ?? null;
  const roster = useMemo(
    () => (channel ? indexMembers(channel.members, CURRENT_USER_ID, stagingAgentIndex()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentsVersion re-reads the registry
    [channel?.members, store.agentsVersion]
  );
  if (!channel || !agent || !roster) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-caption text-text-muted">That agent isn&apos;t running here.</p>
      </div>
    );
  }
  return (
    <StagingAgentBody
      agent={agent}
      channelId={channelId}
      threadId={threadId}
      narration={channel.narration[agent.agentId ?? ""] ?? []}
      messages={channel.messages}
      roster={roster}
      onSend={(text) => store.actions.sendDm(agent.agentId ?? "", text)}
    />
  );
}

function StagingAgentBody({
  agent,
  channelId,
  threadId,
  narration,
  messages,
  roster,
  onSend,
}: {
  agent: DesktopSessionSummary;
  channelId: string;
  threadId: string;
  narration: DesktopNarrationEntry[];
  messages: ChannelMessage[];
  roster: AuthorIndex;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const color = roster.agents.get(agent.agentId ?? "")?.color ?? null;
  const face = useAgentIdentity({
    photo: stagingOwnerPhoto(agent.agentId),
    name: agentDisplayName(agent),
    color,
    runtime: agent.runtimeId,
  });
  const ended = agent.state === "ended";
  const { entries, endNote } = ended ? splitEndNote(narration) : { entries: narration, endNote: null };
  const text = draft.trim();
  return (
    <aside aria-label="Agent view" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <AgentWorkingOn agent={agent} endNote={endNote} />
      <PostureControls
        agent={agent}
        channelId={channelId}
        threadId={threadId}
        stats={<AgentStats agent={agent} showStarted={false} />}
      />
      <AgentHeldGates agent={agent} className="shrink-0 px-4 pt-2.5" />
      <AgentStream
        liveness={agentLiveness(agent)}
        entries={entries}
        supported
        sent={agentSentMessages(messages, threadId, CURRENT_USER_ID, agent.agentId)}
        delivered={messages}
        destination={postDestination(agent)}
        viewer={VIEWER}
        roster={roster}
        self={face}
        color={color}
        className="px-4"
      />
      <div className={cn("shrink-0 pt-3", COMPOSER_BOTTOM, "px-4")}>
        <ComposerInputRow
          face="pill"
          value={draft}
          onChange={setDraft}
          placeholder={`Message ${agentDisplayName(agent)}`}
          ariaLabel="Message your agent"
          onSend={() => {
            if (!text) return;
            onSend(text);
            setDraft("");
          }}
          sendDisabled={text.length === 0}
          sendTitle={text ? "Send" : "Write a message first"}
          sendLabel="Send"
        />
      </div>
    </aside>
  );
}

/** Empty on purpose, as in `agent-window-launch.tsx › NO_ROSTER`. */
const NO_ROSTER: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }> = [];

/**
 * `@/features/channels/components/agent-window-launch › AgentWindowLaunch` — the "+"'s New agent
 * form: the product's `LaunchAgentDialog` on the /channels staging store's launch controls
 * (`useStagingChannels › launch`, which /channels' composer hands the same dialog). Launch adds
 * the agent to the window's channel, so the rail lists it.
 */
export function AgentWindowLaunch({
  panel,
  threadId,
  sessions,
}: {
  panel: AgentLaunchPanel;
  workspaceId: string;
  currentUserId: string;
  channelId: string;
  threadId: string;
  sessions?: readonly DesktopSessionSummary[] | null;
  agent: DesktopSessionSummary | null;
}) {
  const store = useWindowStore();
  const fixture = store.fixture;
  const channelId = fixture?.channel.id ?? "";
  const liveSessions = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => s.channelId === channelId)
        .map((s) => ({
          state: s.state,
          color: agentColorOrNull(s.color),
          name: s.name,
          displayName: s.displayName ?? null,
        })),
    [sessions, channelId]
  );
  if (!fixture) return null;
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={store.actions.launch}
      liveSessions={liveSessions}
      openThreadId={threadId || null}
      channelId={channelId}
      workspaceId={fixture.channel.workspaceId}
      currentUserId={CURRENT_USER_ID}
      members={NO_ROSTER}
    />
  );
}
